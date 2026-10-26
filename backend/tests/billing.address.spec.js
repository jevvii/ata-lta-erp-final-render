/**
 * Billing invoice client address Field-Level Security & Client Master Immutability tests (AC-4, AC-5).
 * Covers Parcel P0-G requirements:
 * - AC-4: PATCH /v1/invoices/:id with address requires billing:edit_client_address (Accounting 200, Operations 403).
 *         PATCH without address succeeds for Operations (200). Field-level audit entry recorded.
 * - AC-5 (Rule R4): Master clients table record remains 100% byte-identical after invoice address update.
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('./helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('./fixtures/supabaseMock');

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const WORK_REQUEST_ID = '33333333-3333-3333-3333-333333333333';
const ACCOUNTING_USER_ID = '22222222-2222-4222-8222-222222222222';
const OPERATIONS_USER_ID = '44444444-4444-4444-8444-444444444444';

const ORIGINAL_CLIENT_RECORD = {
  id: CLIENT_ID,
  entity_id: 'ent-ata',
  name: 'Acme Corporation',
  tin: '123-456-789-00001',
  address: '100 Ayala Avenue, Makati City, Metro Manila',
  status: 'Active',
  created_by: 'user-system',
  updated_by: 'user-system',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  version: 1,
};

const validInvoicePayload = {
  invoiceNumber: 'ATA-SI-2026-0001',
  clientId: CLIENT_ID,
  workRequestId: WORK_REQUEST_ID,
  issueDate: '2026-10-01',
  dueDate: '2026-10-31',
  status: 'Draft',
  lineItems: [{ description: 'Accounting retainers', amount: 15000, type: 'Professional Fee' }],
  notes: 'Original invoice notes',
  terms: 'Payment due in 30 days',
};

const seedData = () => {
  // Deep clone so mockTables gets an isolated copy
  mockTables.clients.set(CLIENT_ID, JSON.parse(JSON.stringify(ORIGINAL_CLIENT_RECORD)));
  mockTables.work_requests.set(WORK_REQUEST_ID, {
    id: WORK_REQUEST_ID,
    entity_id: 'ent-ata',
    client_id: CLIENT_ID,
    title: 'Acme Annual Audit',
    status: 'In Progress',
    co_assignees: [ACCOUNTING_USER_ID, OPERATIONS_USER_ID],
  });
};

describe('Parcel P0-G: Billing Field-Level Security & Client Immutability', () => {
  let adminToken;
  let accountingToken;
  let operationsToken;
  let invoiceId;

  beforeEach(async () => {
    resetMock();
    seedDefaults();
    seedData();

    adminToken = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA'],
    });

    accountingToken = registerUser({
      id: ACCOUNTING_USER_ID,
      email: 'accounting@ata-lta.ph',
      name: 'Accounting User',
      role: 'Accounting',
      entities: ['ATA'],
    });

    operationsToken = registerUser({
      id: OPERATIONS_USER_ID,
      email: 'operations@ata-lta.ph',
      name: 'Operations User',
      role: 'Operations',
      entities: ['ATA'],
    });

    // Create an initial invoice
    const createRes = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoicePayload)
      .expect(201);

    invoiceId = createRes.body.data.id;
  });

  describe('AC-4: Field-Level Security on Client Address Updates', () => {
    it('allows Accounting to update client address on an invoice via PATCH (200 OK)', async () => {
      const newBillingAddress = '456 Business Park, Suite 800, BGC, Taguig';

      const res = await request(app)
        .patch(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ address: newBillingAddress })
        .expect(200);

      expect(res.body.data.id).toBe(invoiceId);

      // Verify invoice record in DB has updated address
      const storedInvoice = mockTables.invoices.get(invoiceId);
      expect(storedInvoice.address).toBe(newBillingAddress);
    });

    it('records a field-level audit log entry when address is modified by Accounting', async () => {
      const newBillingAddress = '789 Finance Tower, Ortigas Center, Pasig';

      await request(app)
        .patch(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ address: newBillingAddress })
        .expect(200);

      // Check audit_logs table for the field-level audit entry
      const auditRows = Array.from(mockTables.audit_logs.values());
      const addressAudit = auditRows.find(
        (a) => a.table_name === 'invoices' && a.action === 'billing.address_update'
      );

      expect(addressAudit).toBeDefined();
      expect(addressAudit.record_id).toBe(invoiceId);
      expect(addressAudit.details).toBeDefined();
      expect(addressAudit.details.field).toBe('address');
      expect(addressAudit.details.from).toBe(ORIGINAL_CLIENT_RECORD.address);
      expect(addressAudit.details.to).toBe(newBillingAddress);
    });

    it('forbids Operations from updating client address on an invoice via PATCH (403 Forbidden)', async () => {
      const attemptedAddress = 'Malicious Address 999 Unauthorized Way';

      const res = await request(app)
        .patch(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${operationsToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ address: attemptedAddress })
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
      expect(res.body.detail).toMatch(/billing:edit_client_address/i);

      // Address on invoice must NOT have changed
      const storedInvoice = mockTables.invoices.get(invoiceId);
      expect(storedInvoice.address).not.toBe(attemptedAddress);
    });

    it('allows Operations to update non-address invoice fields via PATCH (200 OK)', async () => {
      const updatedNotes = 'Operations notes: docs verified, ready for courier';

      const res = await request(app)
        .patch(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${operationsToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ notes: updatedNotes })
        .expect(200);

      expect(res.body.data.notes).toBe(updatedNotes);

      const storedInvoice = mockTables.invoices.get(invoiceId);
      expect(storedInvoice.notes).toBe(updatedNotes);
    });

    it('allows Admin to update client address on invoice (200 OK)', async () => {
      const adminAddress = 'Admin Updated HQ 500 Enterprise Way';

      const res = await request(app)
        .patch(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ address: adminAddress })
        .expect(200);

      expect(res.body.data.id).toBe(invoiceId);
      expect(mockTables.invoices.get(invoiceId).address).toBe(adminAddress);
    });

    it('rejects with 400 Bad Request when address exceeds maximum length of 500', async () => {
      const overlyLongAddress = 'A'.repeat(501);

      const res = await request(app)
        .patch(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ address: overlyLongAddress })
        .expect(400);

      expect(res.body.title).toMatch(/validation error/i);
    });
  });

  describe('AC-5 & R4: Client Master Table Immutability', () => {
    it('guarantees clients table row remains 100% byte-identical after invoice address update', async () => {
      // 1. Capture exact byte-level snapshot before the invoice update
      const clientBefore = mockTables.clients.get(CLIENT_ID);
      const snapshotBeforeJson = JSON.stringify(clientBefore);
      const snapshotBeforeObj = JSON.parse(snapshotBeforeJson);

      // 2. Perform invoice address update via Accounting PATCH
      const newInvoiceAddress = 'Client Billing Branch, 32nd St, BGC, Taguig';
      await request(app)
        .patch(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ address: newInvoiceAddress })
        .expect(200);

      // 3. Verify invoice record received the address
      const updatedInvoice = mockTables.invoices.get(invoiceId);
      expect(updatedInvoice.address).toBe(newInvoiceAddress);

      // 4. Capture byte-level snapshot of clients table row after the update
      const clientAfter = mockTables.clients.get(CLIENT_ID);
      const snapshotAfterJson = JSON.stringify(clientAfter);

      // 5. Strict byte-for-byte immutability assertion
      expect(snapshotAfterJson).toBe(snapshotBeforeJson);
      expect(clientAfter).toEqual(snapshotBeforeObj);

      // Specific individual field checks for defense-in-depth
      expect(clientAfter.address).toBe(ORIGINAL_CLIENT_RECORD.address);
      expect(clientAfter.name).toBe(ORIGINAL_CLIENT_RECORD.name);
      expect(clientAfter.tin).toBe(ORIGINAL_CLIENT_RECORD.tin);
      expect(clientAfter.version).toBe(ORIGINAL_CLIENT_RECORD.version);
      expect(clientAfter.updated_at).toBe(ORIGINAL_CLIENT_RECORD.updated_at);
      expect(clientAfter.updated_by).toBe(ORIGINAL_CLIENT_RECORD.updated_by);
    });
  });
});
