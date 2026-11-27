/**
 * Regression & TDD suite for:
 * 1. Rogue billing exclusion in /v1/invoices/counts (exact parity with /v1/invoices)
 * 2. Authoritative next-invoice-number preview (/v1/invoices/next-number)
 * 3. Collision-free server-side invoice number allocation when rogue, deleted,
 *    or out-of-scope invoices occupy prior sequence slots (e.g. -001 / -0001).
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const CLIENT_ATA = '11111111-1111-4111-8111-111111111111';
const CLIENT_LTA = '22222222-2222-4222-8222-222222222222';
const WR_ATA_ACTIVE = '33333333-3333-4333-8333-333333333331';
const WR_ATA_DELETED = '33333333-3333-4333-8333-333333333332';
const WR_ATA_PENDING = '33333333-3333-4333-8333-333333333333';
const WR_ATA_OTHER = '33333333-3333-4333-8333-333333333334';
const WR_LTA_ACTIVE = '33333333-3333-4333-8333-333333333335';

const TASK_ATA_ACTIVE = '44444444-4444-4444-8444-444444444441';
const TASK_ATA_DELETED = '44444444-4444-4444-8444-444444444442';
const TASK_ATA_OTHER = '44444444-4444-4444-8444-444444444443';
const TASK_LTA_ACTIVE = '44444444-4444-4444-8444-444444444444';

const CURRENT_YEAR = new Date().getFullYear();

const seedFixtures = () => {
  mockTables.clients.set(CLIENT_ATA, {
    id: CLIENT_ATA,
    entity_id: 'ent-ata',
    name: 'Acme ATA Corp',
    tin: '123-456-789-00001',
    status: 'Active',
  });
  mockTables.clients.set(CLIENT_LTA, {
    id: CLIENT_LTA,
    entity_id: 'ent-lta',
    name: 'Beta LTA Corp',
    tin: '123-456-789-00002',
    status: 'Active',
  });

  mockTables.work_requests.set(WR_ATA_ACTIVE, {
    id: WR_ATA_ACTIVE,
    entity_id: 'ent-ata',
    client_id: CLIENT_ATA,
    title: 'Active ATA Engagement',
    status: 'In Progress',
    creation_approval_status: 'approved',
    deleted_at: null,
  });
  mockTables.work_requests.set(WR_ATA_DELETED, {
    id: WR_ATA_DELETED,
    entity_id: 'ent-ata',
    client_id: CLIENT_ATA,
    title: 'Deleted ATA Engagement',
    status: 'Cancelled',
    creation_approval_status: 'approved',
    deleted_at: '2026-10-10T00:00:00.000Z',
  });
  mockTables.work_requests.set(WR_ATA_PENDING, {
    id: WR_ATA_PENDING,
    entity_id: 'ent-ata',
    client_id: CLIENT_ATA,
    title: 'Pending ATA Engagement',
    status: 'Draft',
    creation_approval_status: 'pending',
    deleted_at: null,
  });
  mockTables.work_requests.set(WR_ATA_OTHER, {
    id: WR_ATA_OTHER,
    entity_id: 'ent-ata',
    client_id: CLIENT_ATA,
    title: 'Other Team ATA Engagement',
    status: 'In Progress',
    creation_approval_status: 'approved',
    deleted_at: null,
  });
  mockTables.work_requests.set(WR_LTA_ACTIVE, {
    id: WR_LTA_ACTIVE,
    entity_id: 'ent-lta',
    client_id: CLIENT_LTA,
    title: 'Active LTA Engagement',
    status: 'In Progress',
    creation_approval_status: 'approved',
    deleted_at: null,
  });

  mockTables.tasks.set(TASK_ATA_ACTIVE, {
    id: TASK_ATA_ACTIVE,
    work_request_id: WR_ATA_ACTIVE,
    title: 'Billing Task Active',
    status: 'In Progress',
    deleted_at: null,
  });
  mockTables.tasks.set(TASK_ATA_DELETED, {
    id: TASK_ATA_DELETED,
    work_request_id: WR_ATA_ACTIVE,
    title: 'Billing Task Deleted',
    status: 'In Progress',
    deleted_at: '2026-10-12T00:00:00.000Z',
  });
  mockTables.tasks.set(TASK_ATA_OTHER, {
    id: TASK_ATA_OTHER,
    work_request_id: WR_ATA_OTHER,
    title: 'Other Team Task',
    status: 'In Progress',
    deleted_at: null,
  });
  mockTables.tasks.set(TASK_LTA_ACTIVE, {
    id: TASK_LTA_ACTIVE,
    work_request_id: WR_LTA_ACTIVE,
    title: 'LTA Billing Task',
    status: 'In Progress',
    deleted_at: null,
  });
};

describe('Rogue Billing Counts & Collision-Free Invoice Numbering', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
    seedFixtures();
  });

  describe('1. GET /v1/invoices/counts parity with GET /v1/invoices (rogue exclusion)', () => {
    it('excludes invoices whose parent work request was soft-deleted from active and archived counts', async () => {
      const adminToken = registerUser({
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      // Seed rogue invoice: invoice itself is not deleted/archived, but parent WR is soft-deleted
      mockTables.invoices.set('inv-rogue-wr', {
        id: 'inv-rogue-wr',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_DELETED,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-001`,
        issue_date: `${CURRENT_YEAR}-10-01`,
        due_date: `${CURRENT_YEAR}-10-31`,
        status: 'Draft',
        total: 15000,
        balance: 15000,
        archived: false,
        deleted_at: null,
        created_at: `${CURRENT_YEAR}-10-01T00:00:00.000Z`,
      });

      const listRes = await request(app)
        .get('/v1/invoices?archived=false')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const countsRes = await request(app)
        .get('/v1/invoices/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(listRes.body.data).toHaveLength(0);
      expect(listRes.body.meta.total).toBe(0);
      expect(countsRes.body.data.active).toBe(0);
      expect(countsRes.body.data.archived).toBe(0);
    });

    it('excludes invoices linked to a soft-deleted task, unapproved WR, or conflicting linkage from counts', async () => {
      const adminToken = registerUser({
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      // 1. Deleted linked task
      mockTables.invoices.set('inv-rogue-task', {
        id: 'inv-rogue-task',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_ACTIVE,
        task_id: TASK_ATA_DELETED,
        linked_task_id: TASK_ATA_DELETED,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-001`,
        status: 'Draft',
        archived: false,
        deleted_at: null,
        created_at: `${CURRENT_YEAR}-10-01T00:00:00.000Z`,
      });

      // 2. Unapproved/pending parent WR
      mockTables.invoices.set('inv-rogue-pending-wr', {
        id: 'inv-rogue-pending-wr',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_PENDING,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-002`,
        status: 'Sent',
        archived: false,
        deleted_at: null,
        created_at: `${CURRENT_YEAR}-10-02T00:00:00.000Z`,
      });

      // 3. Conflicting task_id vs linked_task_id
      mockTables.invoices.set('inv-rogue-conflict', {
        id: 'inv-rogue-conflict',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_ACTIVE,
        task_id: TASK_ATA_ACTIVE,
        linked_task_id: TASK_ATA_OTHER,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-003`,
        status: 'Draft',
        archived: false,
        deleted_at: null,
        created_at: `${CURRENT_YEAR}-10-03T00:00:00.000Z`,
      });

      // 4. Entity mismatch (invoice entity ATA, WR entity LTA)
      mockTables.invoices.set('inv-rogue-entity-mismatch', {
        id: 'inv-rogue-entity-mismatch',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_LTA_ACTIVE,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-004`,
        status: 'Draft',
        archived: false,
        deleted_at: null,
        created_at: `${CURRENT_YEAR}-10-04T00:00:00.000Z`,
      });

      // 5. One legitimate active invoice
      mockTables.invoices.set('inv-valid-1', {
        id: 'inv-valid-1',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_ACTIVE,
        task_id: TASK_ATA_ACTIVE,
        linked_task_id: TASK_ATA_ACTIVE,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-005`,
        status: 'Draft',
        archived: false,
        deleted_at: null,
        created_at: `${CURRENT_YEAR}-10-05T00:00:00.000Z`,
      });

      const listRes = await request(app)
        .get('/v1/invoices?archived=false')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const countsRes = await request(app)
        .get('/v1/invoices/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(listRes.body.data).toHaveLength(1);
      expect(listRes.body.data[0].id).toBe('inv-valid-1');
      expect(countsRes.body.data.active).toBe(1);
      expect(countsRes.body.data.archived).toBe(0);
    });

    it('counts archived non-Paid invoices accurately and never double-counts archived Cancelled invoices', async () => {
      const adminToken = registerUser({
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      // Archived Draft
      mockTables.invoices.set('inv-arch-draft', {
        id: 'inv-arch-draft',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_ACTIVE,
        task_id: TASK_ATA_ACTIVE,
        linked_task_id: TASK_ATA_ACTIVE,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-010`,
        status: 'Draft',
        archived: true,
        deleted_at: null,
      });

      // Cancelled AND archived=true
      mockTables.invoices.set('inv-arch-cancelled', {
        id: 'inv-arch-cancelled',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_ACTIVE,
        task_id: TASK_ATA_ACTIVE,
        linked_task_id: TASK_ATA_ACTIVE,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-011`,
        status: 'Cancelled',
        archived: true,
        deleted_at: null,
      });

      // Archived Paid
      mockTables.invoices.set('inv-arch-paid', {
        id: 'inv-arch-paid',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_ACTIVE,
        task_id: TASK_ATA_ACTIVE,
        linked_task_id: TASK_ATA_ACTIVE,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-012`,
        status: 'Paid',
        archived: true,
        deleted_at: null,
      });

      const archivedListRes = await request(app)
        .get('/v1/invoices?archived=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const countsRes = await request(app)
        .get('/v1/invoices/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(archivedListRes.body.meta.total).toBe(3);
      expect(countsRes.body.data.active).toBe(0);
      expect(countsRes.body.data.archived).toBe(3);
    });

    it('supports consolidated ALL entity counts for Admin with entities:["ALL"]', async () => {
      const adminToken = registerUser({
        id: '00000000-0000-4000-a000-000000000002',
        email: 'superadmin@ata-lta.ph',
        name: 'Super Admin',
        role: 'Admin',
        entities: ['ALL'],
      });

      mockTables.invoices.set('inv-ata-1', {
        id: 'inv-ata-1',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_ACTIVE,
        task_id: TASK_ATA_ACTIVE,
        linked_task_id: TASK_ATA_ACTIVE,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-0001`,
        status: 'Draft',
        archived: false,
        deleted_at: null,
      });
      mockTables.invoices.set('inv-lta-1', {
        id: 'inv-lta-1',
        entity_id: 'ent-lta',
        client_id: CLIENT_LTA,
        work_request_id: WR_LTA_ACTIVE,
        task_id: TASK_LTA_ACTIVE,
        linked_task_id: TASK_LTA_ACTIVE,
        invoice_number: `LTA-SI-${CURRENT_YEAR}-0001`,
        status: 'Sent',
        archived: false,
        deleted_at: null,
      });

      const listRes = await request(app)
        .get('/v1/invoices?archived=false')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL')
        .expect(200);

      const countsRes = await request(app)
        .get('/v1/invoices/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL')
        .expect(200);

      expect(listRes.body.meta.total).toBe(2);
      expect(countsRes.body.data.active).toBe(2);
    });
  });

  describe('2. GET /v1/invoices/next-number authoritative preview', () => {
    it('advances past rogue (deleted-parent) 3-digit -001 invoice instead of getting stuck at 001', async () => {
      const adminToken = registerUser({
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      // Rogue invoice with deleted WR and 3-digit -001 number (document_sequences untouched)
      mockTables.invoices.set('inv-rogue-001', {
        id: 'inv-rogue-001',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_DELETED,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-001`,
        status: 'Draft',
        archived: false,
        deleted_at: null,
      });

      const res = await request(app)
        .get('/v1/invoices/next-number')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.invoiceNumber).toBe(`ATA-SI-${CURRENT_YEAR}-0002`);
      expect(res.body.data.nextSequence).toBe(2);
      expect(res.body.data.entityCode).toBe('ATA');

      // Preview must be read-only and NOT burn sequence numbers on repeated calls
      const res2 = await request(app)
        .get('/v1/invoices/next-number')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res2.body.data.invoiceNumber).toBe(`ATA-SI-${CURRENT_YEAR}-0002`);
    });

    it('advances past soft-deleted invoices and out-of-scope invoices for non-Admin Accounting users', async () => {
      const acctUserId = '00000000-0000-4000-a000-000000000010';
      const acctToken = registerUser({
        id: acctUserId,
        email: 'acct@ata-lta.ph',
        name: 'Accounting Staff',
        role: 'Accounting',
        entities: ['ATA'],
      });
      mockTables.tasks.get(TASK_ATA_ACTIVE).assignee_id = acctUserId;

      // Soft-deleted invoice #003
      mockTables.invoices.set('inv-deleted-003', {
        id: 'inv-deleted-003',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_ACTIVE,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-003`,
        status: 'Draft',
        deleted_at: `${CURRENT_YEAR}-10-05T00:00:00.000Z`,
      });

      // Invoice #0005 on WR_ATA_OTHER (not visible to acctUserId)
      mockTables.invoices.set('inv-other-wr-0005', {
        id: 'inv-other-wr-0005',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_OTHER,
        task_id: TASK_ATA_OTHER,
        linked_task_id: TASK_ATA_OTHER,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-0005`,
        status: 'Sent',
        archived: false,
        deleted_at: null,
      });

      // Confirm acctUser sees 0 invoices in the regular list
      const listRes = await request(app)
        .get('/v1/invoices')
        .set('Authorization', `Bearer ${acctToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(listRes.body.data).toHaveLength(0);

      // Next-number still returns 0006 without leaking any details
      const nextRes = await request(app)
        .get('/v1/invoices/next-number')
        .set('Authorization', `Bearer ${acctToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(nextRes.body.data.invoiceNumber).toBe(`ATA-SI-${CURRENT_YEAR}-0006`);
      expect(nextRes.body.data.nextSequence).toBe(6);
    });

    it('resolves target entity from workRequestId/clientId/entity when X-Active-Entity is ALL and respects document_sequences', async () => {
      const adminToken = registerUser({
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      mockTables.document_sequences.set(`LTA-SI-${CURRENT_YEAR}`, {
        prefix: `LTA-SI-${CURRENT_YEAR}`,
        current_val: 7,
      });

      const resByWr = await request(app)
        .get(`/v1/invoices/next-number?workRequestId=${WR_LTA_ACTIVE}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL')
        .expect(200);

      expect(resByWr.body.data.entityCode).toBe('LTA');
      expect(resByWr.body.data.invoiceNumber).toBe(`LTA-SI-${CURRENT_YEAR}-0008`);

      const resByYear = await request(app)
        .get(`/v1/invoices/next-number?entity=LTA&issueDate=${CURRENT_YEAR + 1}-01-15`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL')
        .expect(200);

      expect(resByYear.body.data.invoiceNumber).toBe(`LTA-SI-${CURRENT_YEAR + 1}-0001`);
    });

    it('strictly enforces single-entity scope on /next-number even if cross-entity query params are supplied', async () => {
      const acctToken = registerUser({
        id: '00000000-0000-4000-a000-000000000011',
        email: 'ata-only@ata-lta.ph',
        name: 'ATA Accounting',
        role: 'Accounting',
        entities: ['ATA'],
      });

      mockTables.document_sequences.set(`LTA-SI-${CURRENT_YEAR}`, {
        prefix: `LTA-SI-${CURRENT_YEAR}`,
        current_val: 99,
      });

      const res = await request(app)
        .get(`/v1/invoices/next-number?entity=LTA&workRequestId=${WR_LTA_ACTIVE}`)
        .set('Authorization', `Bearer ${acctToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.entityCode).toBe('ATA');
      expect(res.body.data.invoiceNumber).toBe(`ATA-SI-${CURRENT_YEAR}-0001`);
    });
  });

  describe('3. POST /v1/invoices collision-free auto-allocation', () => {
    it('allocates ATA-SI-YYYY-0002 when rogue -001 occupies slot 1 and document_sequences is behind', async () => {
      const adminToken = registerUser({
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      // Rogue 3-digit -001 exists while document_sequences has no entry (0)
      mockTables.invoices.set('inv-rogue-001', {
        id: 'inv-rogue-001',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_DELETED,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-001`,
        status: 'Draft',
        archived: false,
        deleted_at: null,
      });

      const createRes = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ATA,
          workRequestId: WR_ATA_ACTIVE,
          taskId: TASK_ATA_ACTIVE,
          issueDate: `${CURRENT_YEAR}-11-01`,
          dueDate: `${CURRENT_YEAR}-12-01`,
          status: 'Draft',
          lineItems: [{ description: 'Advisory Fee', amount: 15000, type: 'Professional Fee' }],
        })
        .expect(201);

      expect(createRes.body.data.invoice_number).toBe(`ATA-SI-${CURRENT_YEAR}-0002`);

      // Subsequent creation continues monotonically without collision
      const createRes2 = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ATA,
          workRequestId: WR_ATA_ACTIVE,
          taskId: TASK_ATA_ACTIVE,
          issueDate: `${CURRENT_YEAR}-11-02`,
          dueDate: `${CURRENT_YEAR}-12-02`,
          status: 'Draft',
          lineItems: [{ description: 'Compliance Fee', amount: 8000, type: 'Professional Fee' }],
        })
        .expect(201);

      expect(createRes2.body.data.invoice_number).toBe(`ATA-SI-${CURRENT_YEAR}-0003`);

      // Audit logs record the allocated invoice number (not undefined)
      const auditEntries = Array.from(mockTables.audit_logs.values()).filter(
        (a) => a.action === 'invoice.create'
      );
      expect(auditEntries.some((a) => a.details?.invoiceNumber === `ATA-SI-${CURRENT_YEAR}-0002`)).toBe(true);
    });

    it('advances past an existing 4-digit -0001 row (e.g. soft-deleted) when document_sequences is at 0', async () => {
      const adminToken = registerUser({
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      mockTables.invoices.set('inv-deleted-0001', {
        id: 'inv-deleted-0001',
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA,
        work_request_id: WR_ATA_ACTIVE,
        invoice_number: `ATA-SI-${CURRENT_YEAR}-0001`,
        status: 'Draft',
        archived: false,
        deleted_at: `${CURRENT_YEAR}-10-01T00:00:00.000Z`,
      });

      const createRes = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ATA,
          workRequestId: WR_ATA_ACTIVE,
          taskId: TASK_ATA_ACTIVE,
          issueDate: `${CURRENT_YEAR}-11-01`,
          dueDate: `${CURRENT_YEAR}-12-01`,
          status: 'Draft',
          lineItems: [{ description: 'Tax Return Prep', amount: 12000, type: 'Professional Fee' }],
        })
        .expect(201);

      expect(createRes.body.data.invoice_number).toBe(`ATA-SI-${CURRENT_YEAR}-0002`);
    });

    it('allocates LTA-prefixed number when X-Active-Entity is ALL and WR/client belongs to LTA', async () => {
      const adminToken = registerUser({
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      const createRes = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL')
        .send({
          clientId: CLIENT_LTA,
          workRequestId: WR_LTA_ACTIVE,
          taskId: TASK_LTA_ACTIVE,
          issueDate: `${CURRENT_YEAR}-11-01`,
          dueDate: `${CURRENT_YEAR}-12-01`,
          status: 'Draft',
          lineItems: [{ description: 'LTA Retainer', amount: 25000, type: 'Professional Fee' }],
        })
        .expect(201);

      expect(createRes.body.data.invoice_number).toBe(`LTA-SI-${CURRENT_YEAR}-0001`);
      expect(createRes.body.data.entity_code).toBe('LTA');
    });

    it('preserves 409 Conflict for explicit duplicate invoiceNumber while advancing auto-allocation after explicit creates', async () => {
      const adminToken = registerUser({
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `ATA-SI-${CURRENT_YEAR}-0005`,
          clientId: CLIENT_ATA,
          workRequestId: WR_ATA_ACTIVE,
          taskId: TASK_ATA_ACTIVE,
          issueDate: `${CURRENT_YEAR}-11-01`,
          dueDate: `${CURRENT_YEAR}-12-01`,
          status: 'Draft',
          lineItems: [{ description: 'Manual #5', amount: 5000, type: 'Professional Fee' }],
        })
        .expect(201);

      // Explicit duplicate still rejected with 409
      await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `ATA-SI-${CURRENT_YEAR}-0005`,
          clientId: CLIENT_ATA,
          workRequestId: WR_ATA_ACTIVE,
          taskId: TASK_ATA_ACTIVE,
          issueDate: `${CURRENT_YEAR}-11-01`,
          dueDate: `${CURRENT_YEAR}-12-01`,
          status: 'Draft',
          lineItems: [{ description: 'Duplicate #5', amount: 5000, type: 'Professional Fee' }],
        })
        .expect(409);

      // Subsequent auto-allocated create advances cleanly to 0006
      const autoRes = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ATA,
          workRequestId: WR_ATA_ACTIVE,
          taskId: TASK_ATA_ACTIVE,
          issueDate: `${CURRENT_YEAR}-11-02`,
          dueDate: `${CURRENT_YEAR}-12-02`,
          status: 'Draft',
          lineItems: [{ description: 'Auto #6', amount: 7000, type: 'Professional Fee' }],
        })
        .expect(201);

      expect(autoRes.body.data.invoice_number).toBe(`ATA-SI-${CURRENT_YEAR}-0006`);
    });
  });
});
