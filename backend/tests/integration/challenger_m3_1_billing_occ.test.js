/**
 * Empirical Adversarial Challenger Test Suite: Milestone 3 (Backend Billing OCC Validation)
 * 
 * Target: Backend Billing Schema & Controller OCC Validation
 * Specifications:
 * - REVIEW.md Section R6
 * - PROJECT.md Feature F10 & Billing Draft OCC Contract
 * - ORIGINAL_REQUEST.md AC6
 * 
 * Scope of Adversarial Verification:
 * 1. Financial field edits ('terms', 'lineItems', 'clientId', 'issueDate', 'dueDate', 'invoiceNumber')
 *    - Missing expectedVersion -> HTTP 400 / Zod validation error
 *    - expectedVersion: null -> HTTP 400 / Zod validation error
 *    - expectedVersion: 0 -> HTTP 400 / Zod validation error (positive integer required)
 *    - expectedVersion: -1 -> HTTP 400 / Zod validation error (negative integer rejected)
 *    - expectedVersion: 1.5 -> HTTP 400 / Zod validation error (float rejected)
 *    - expectedVersion: "1" (string) -> HTTP 400 / Zod validation error (string rejected)
 *    - expectedVersion: true / false / NaN / Infinity / {} / [] -> HTTP 400
 *    - Missing body {} -> HTTP 400 or state preservation
 * 2. Non-financial field edits ('notes', 'address', 'clientAddress', 'status', 'archived')
 *    - Executed without expectedVersion -> Succeeds with HTTP 200 without requiring expectedVersion
 * 3. Financial field edits with valid positive integer expectedVersion: 1
 *    - Passes schema validation, returns HTTP 200, updates state in DB, increments version
 * 4. Optimistic Concurrency Control (OCC) Stale-Write Protection:
 *    - Stale expectedVersion returns HTTP 409 Conflict (ERR_CONCURRENCY_CONFLICT)
 *    - Future expectedVersion returns HTTP 409 Conflict
 * 5. State Immutability on Rejection:
 *    - On any HTTP 400 validation rejection, invoice fields and version remain strictly unchanged
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const {
  registerUser,
  resetMock,
  mockTables,
} = require('../fixtures/supabaseMock');
const { updateInvoiceSchema } = require('../../src/modules/billing/schema');

const ENT_ATA = 'ent-ata';
const CLIENT_ID_1 = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID_2 = '22222222-2222-4222-8222-222222222222';
const WORK_REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const INVOICE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ADMIN_USER_ID = '00000000-0000-4000-a000-000000000001';
const ACCT_USER_ID = '00000000-0000-4000-a000-000000000002';

const FINANCIAL_FIELDS = [
  'terms',
  'lineItems',
  'clientId',
  'issueDate',
  'dueDate',
  'invoiceNumber',
];

const SAMPLE_PAYLOADS = {
  terms: { terms: 'Net 60 Payment Terms' },
  lineItems: {
    lineItems: [
      { description: 'Consulting Services', amount: 5000, type: 'Professional Fee' },
    ],
  },
  clientId: { clientId: CLIENT_ID_2 },
  issueDate: { issueDate: '2026-11-01' },
  dueDate: { dueDate: '2026-11-30' },
  invoiceNumber: { invoiceNumber: 'ATA-INV-2026-999' },
};

describe('Empirical Adversarial Verification: Milestone 3 (Backend Billing OCC)', () => {
  let adminToken;
  let accountingToken;

  beforeEach(() => {
    resetMock();

    // Register test actors
    adminToken = registerUser({
      id: ADMIN_USER_ID,
      email: 'admin@ata-lta.ph',
      name: 'System Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    accountingToken = registerUser({
      id: ACCT_USER_ID,
      email: 'acct@ata-lta.ph',
      name: 'Accounting Staff',
      role: 'Accounting',
      departments: ['Accounting'],
      entities: ['ATA'],
    });

    // Seed entity, clients, work request
    mockTables.entities.set(ENT_ATA, { id: ENT_ATA, code: 'ATA', name: 'ATA Entity' });
    mockTables.clients.set(CLIENT_ID_1, {
      id: CLIENT_ID_1,
      entity_id: ENT_ATA,
      name: 'Alpha Corp',
      tin: '111-111-111-00000',
      status: 'Active',
      deleted_at: null,
    });
    mockTables.clients.set(CLIENT_ID_2, {
      id: CLIENT_ID_2,
      entity_id: ENT_ATA,
      name: 'Beta Corp',
      tin: '222-222-222-00000',
      status: 'Active',
      deleted_at: null,
    });
    mockTables.work_requests.set(WORK_REQUEST_ID, {
      id: WORK_REQUEST_ID,
      entity_id: ENT_ATA,
      client_id: CLIENT_ID_1,
      title: 'Audit WR',
      status: 'In Progress',
      assigned_to: ACCT_USER_ID,
      co_assignees: [],
      deleted_at: null,
      archived: false,
    });

    // Seed baseline Draft invoice at version 1
    mockTables.invoices.set(INVOICE_ID, {
      id: INVOICE_ID,
      entity_id: ENT_ATA,
      client_id: CLIENT_ID_1,
      work_request_id: WORK_REQUEST_ID,
      invoice_number: 'ATA-INV-2026-001',
      status: 'Draft',
      version: 1,
      total: 10000,
      subtotal: 10000,
      balance: 10000,
      amount_paid: 0,
      terms: 'Net 30 Initial',
      notes: 'Initial notes',
      address: '123 Initial St, Manila',
      issue_date: '2026-10-01',
      due_date: '2026-10-31',
      archived: false,
      deleted_at: null,
    });
  });

  // =========================================================================
  // 1. DIRECT SCHEMA STRESS TESTS (updateInvoiceSchema)
  // =========================================================================
  describe('1. Direct updateInvoiceSchema Validation', () => {
    describe.each(FINANCIAL_FIELDS)('Financial field "%s"', (field) => {
      const basePayload = SAMPLE_PAYLOADS[field];

      it(`rejects missing expectedVersion`, () => {
        const result = updateInvoiceSchema.safeParse({ ...basePayload });
        expect(result.success).toBe(false);
        const issues = result.error.issues;
        expect(issues.some((i) => i.path.includes('expectedVersion'))).toBe(true);
        expect(issues[0].message).toMatch(/expectedVersion is required/i);
      });

      it(`rejects expectedVersion: null`, () => {
        const result = updateInvoiceSchema.safeParse({
          ...basePayload,
          expectedVersion: null,
        });
        expect(result.success).toBe(false);
        const issues = result.error.issues;
        expect(issues.some((i) => i.path.includes('expectedVersion'))).toBe(true);
      });

      it(`rejects expectedVersion: 0 (non-positive)`, () => {
        const result = updateInvoiceSchema.safeParse({
          ...basePayload,
          expectedVersion: 0,
        });
        expect(result.success).toBe(false);
        const issues = result.error.issues;
        expect(issues.some((i) => i.path.includes('expectedVersion'))).toBe(true);
      });

      it(`rejects expectedVersion: -1 (negative)`, () => {
        const result = updateInvoiceSchema.safeParse({
          ...basePayload,
          expectedVersion: -1,
        });
        expect(result.success).toBe(false);
        const issues = result.error.issues;
        expect(issues.some((i) => i.path.includes('expectedVersion'))).toBe(true);
      });

      it(`rejects expectedVersion: 1.5 (non-integer float)`, () => {
        const result = updateInvoiceSchema.safeParse({
          ...basePayload,
          expectedVersion: 1.5,
        });
        expect(result.success).toBe(false);
        const issues = result.error.issues;
        expect(issues.some((i) => i.path.includes('expectedVersion'))).toBe(true);
      });

      it(`rejects expectedVersion: "1" (string)`, () => {
        const result = updateInvoiceSchema.safeParse({
          ...basePayload,
          expectedVersion: '1',
        });
        expect(result.success).toBe(false);
        const issues = result.error.issues;
        expect(issues.some((i) => i.path.includes('expectedVersion'))).toBe(true);
      });

      it(`rejects expectedVersion: boolean true/false`, () => {
        expect(
          updateInvoiceSchema.safeParse({ ...basePayload, expectedVersion: true }).success
        ).toBe(false);
        expect(
          updateInvoiceSchema.safeParse({ ...basePayload, expectedVersion: false }).success
        ).toBe(false);
      });

      it(`rejects expectedVersion: NaN and Infinity`, () => {
        expect(
          updateInvoiceSchema.safeParse({ ...basePayload, expectedVersion: NaN }).success
        ).toBe(false);
        expect(
          updateInvoiceSchema.safeParse({ ...basePayload, expectedVersion: Infinity }).success
        ).toBe(false);
        expect(
          updateInvoiceSchema.safeParse({ ...basePayload, expectedVersion: -Infinity }).success
        ).toBe(false);
      });

      it(`rejects expectedVersion: object and array`, () => {
        expect(
          updateInvoiceSchema.safeParse({ ...basePayload, expectedVersion: { ver: 1 } }).success
        ).toBe(false);
        expect(
          updateInvoiceSchema.safeParse({ ...basePayload, expectedVersion: [1] }).success
        ).toBe(false);
      });

      it(`accepts valid positive integer expectedVersion: 1`, () => {
        const result = updateInvoiceSchema.safeParse({
          ...basePayload,
          expectedVersion: 1,
        });
        expect(result.success).toBe(true);
        expect(result.data.expectedVersion).toBe(1);
      });
    });

    describe('Non-financial fields in updateInvoiceSchema', () => {
      it('accepts notes without expectedVersion', () => {
        const result = updateInvoiceSchema.safeParse({ notes: 'Updated notes' });
        expect(result.success).toBe(true);
        expect(result.data.notes).toBe('Updated notes');
      });

      it('accepts address without expectedVersion', () => {
        const result = updateInvoiceSchema.safeParse({ address: '456 Elm St' });
        expect(result.success).toBe(true);
        expect(result.data.address).toBe('456 Elm St');
      });

      it('accepts clientAddress without expectedVersion', () => {
        const result = updateInvoiceSchema.safeParse({ clientAddress: '789 Oak Ave' });
        expect(result.success).toBe(true);
        expect(result.data.clientAddress).toBe('789 Oak Ave');
      });

      it('accepts status without expectedVersion', () => {
        const result = updateInvoiceSchema.safeParse({ status: 'Draft' });
        expect(result.success).toBe(true);
        expect(result.data.status).toBe('Draft');
      });

      it('accepts archived without expectedVersion', () => {
        const result = updateInvoiceSchema.safeParse({ archived: true });
        expect(result.success).toBe(true);
        expect(result.data.archived).toBe(true);
      });

      it('accepts empty object {}', () => {
        const result = updateInvoiceSchema.safeParse({});
        expect(result.success).toBe(true);
      });
    });
  });

  // =========================================================================
  // 2. HTTP CONTROLLER ADVERSARIAL STRESS TESTS (PATCH / PUT /v1/invoices/:id)
  // =========================================================================
  describe('2. HTTP Controller Adversarial Validation (PATCH & PUT)', () => {
    describe.each(FINANCIAL_FIELDS)('HTTP financial edit rejection: "%s"', (field) => {
      const basePayload = SAMPLE_PAYLOADS[field];

      it(`returns HTTP 400 when expectedVersion is missing and preserves DB state`, async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ ...basePayload });

        expect(res.status).toBe(400);
        expect(res.body.title).toBe('Validation Error');
        expect(res.body.detail).toMatch(/expectedVersion/i);

        // State immutability check
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.version).toBe(1);
        expect(inv.terms).toBe('Net 30 Initial');
        expect(inv.invoice_number).toBe('ATA-INV-2026-001');
      });

      it(`returns HTTP 400 when expectedVersion is null`, async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ ...basePayload, expectedVersion: null });

        expect(res.status).toBe(400);
        expect(res.body.title).toBe('Validation Error');
        expect(res.body.detail).toMatch(/expectedVersion/i);

        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.version).toBe(1);
      });

      it(`returns HTTP 400 when expectedVersion is 0`, async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ ...basePayload, expectedVersion: 0 });

        expect(res.status).toBe(400);
        expect(res.body.title).toBe('Validation Error');
        expect(res.body.detail).toMatch(/expectedVersion/i);

        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.version).toBe(1);
      });

      it(`returns HTTP 400 when expectedVersion is -1`, async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ ...basePayload, expectedVersion: -1 });

        expect(res.status).toBe(400);
        expect(res.body.title).toBe('Validation Error');
        expect(res.body.detail).toMatch(/expectedVersion/i);

        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.version).toBe(1);
      });

      it(`returns HTTP 400 when expectedVersion is 1.5 (float)`, async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ ...basePayload, expectedVersion: 1.5 });

        expect(res.status).toBe(400);
        expect(res.body.title).toBe('Validation Error');
        expect(res.body.detail).toMatch(/expectedVersion/i);

        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.version).toBe(1);
      });

      it(`returns HTTP 400 when expectedVersion is "1" (string)`, async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ ...basePayload, expectedVersion: '1' });

        expect(res.status).toBe(400);
        expect(res.body.title).toBe('Validation Error');
        expect(res.body.detail).toMatch(/expectedVersion/i);

        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.version).toBe(1);
      });

      it(`enforces rejection via PUT as well as PATCH`, async () => {
        const res = await request(app)
          .put(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ ...basePayload });

        expect(res.status).toBe(400);
        expect(res.body.title).toBe('Validation Error');
        expect(res.body.detail).toMatch(/expectedVersion/i);

        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.version).toBe(1);
      });
    });

    describe('Missing body {} handling', () => {
      it('preserves invoice state without corrupting financial fields on {} body', async () => {
        const before = JSON.parse(JSON.stringify(mockTables.invoices.get(INVOICE_ID)));

        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({});

        // Must either return HTTP 400 or preserve state
        expect([200, 400]).toContain(res.status);

        const after = mockTables.invoices.get(INVOICE_ID);
        expect(after.total).toBe(before.total);
        expect(after.subtotal).toBe(before.subtotal);
        expect(after.balance).toBe(before.balance);
        expect(after.terms).toBe(before.terms);
        expect(after.invoice_number).toBe(before.invoice_number);
        expect(after.status).toBe(before.status);
      });
    });

    describe('Non-financial edits succeed without expectedVersion', () => {
      it('updates notes without requiring expectedVersion', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ notes: 'Adversarial notes update without version' });

        expect(res.status).toBe(200);
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.notes).toBe('Adversarial notes update without version');
      });

      it('updates address without requiring expectedVersion', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ address: '777 Enterprise Blvd, Taguig' });

        expect(res.status).toBe(200);
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.address).toBe('777 Enterprise Blvd, Taguig');
      });

      it('updates clientAddress without requiring expectedVersion', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ clientAddress: '888 Bonifacio High St, Taguig' });

        expect(res.status).toBe(200);
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.address).toBe('888 Bonifacio High St, Taguig');
      });

      it('preserves status without requiring expectedVersion', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ status: 'Draft' });

        expect(res.status).toBe(200);
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.status).toBe('Draft');
      });
    });

    describe('Financial edits with valid positive integer expectedVersion: 1', () => {
      it('updates terms and increments version with expectedVersion: 1', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            terms: 'Net 45 Valid Update',
            expectedVersion: 1,
          });

        expect(res.status).toBe(200);
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.terms).toBe('Net 45 Valid Update');
        expect(inv.version).toBe(2);
      });

      it('updates lineItems, recalculates totals, and increments version with valid expectedVersion', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            lineItems: [
              { description: 'Tax Consulting', amount: 15000, type: 'Professional Fee' },
              { description: 'Filing Fee', amount: 2500, type: 'Government Fee' },
            ],
            expectedVersion: 1,
          });

        expect(res.status).toBe(200);
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.total).toBe(17500);
        expect(inv.subtotal).toBe(17500);
        expect(inv.balance).toBe(17500);
        expect(inv.version).toBe(2);
      });

      it('updates invoiceNumber with valid expectedVersion: 1', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            invoiceNumber: 'ATA-INV-2026-RENUMBERED',
            expectedVersion: 1,
          });

        expect(res.status).toBe(200);
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.invoice_number).toBe('ATA-INV-2026-RENUMBERED');
        expect(inv.version).toBe(2);
      });

      it('updates issueDate and dueDate with valid expectedVersion: 1', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            issueDate: '2026-11-15',
            dueDate: '2026-12-15',
            expectedVersion: 1,
          });

        expect(res.status).toBe(200);
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.issue_date).toBe('2026-11-15');
        expect(inv.due_date).toBe('2026-12-15');
        expect(inv.version).toBe(2);
      });

      it('updates clientId with valid expectedVersion: 1', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            clientId: CLIENT_ID_2,
            expectedVersion: 1,
          });

        expect(res.status).toBe(200);
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.client_id).toBe(CLIENT_ID_2);
        expect(inv.version).toBe(2);
      });
    });

    describe('OCC Concurrency & Conflict Protection (HTTP 409)', () => {
      it('rejects stale expectedVersion with HTTP 409 Conflict', async () => {
        // First successful update bumps version from 1 to 2
        await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            terms: 'First Update Version 1 -> 2',
            expectedVersion: 1,
          })
          .expect(200);

        // Stale update: caller sends expectedVersion: 1 when invoice is now version 2
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            terms: 'Stale Concurrent Update',
            expectedVersion: 1,
          });

        expect(res.status).toBe(409);
        expect(res.body.title).toBe('Conflict');
        expect(res.body.code).toBe('ERR_CONCURRENCY_CONFLICT');

        // Verify terms from first update were NOT overwritten
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.terms).toBe('First Update Version 1 -> 2');
        expect(inv.version).toBe(2);
      });

      it('rejects future/unmatched expectedVersion with HTTP 409 Conflict', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            terms: 'Future Version Update',
            expectedVersion: 999,
          });

        expect(res.status).toBe(409);
        expect(res.body.title).toBe('Conflict');
        expect(res.body.code).toBe('ERR_CONCURRENCY_CONFLICT');

        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.version).toBe(1);
      });
    });

    describe('Mixed and Edge Case Payloads', () => {
      it('rejects payload mixing financial and non-financial fields if expectedVersion is missing', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            notes: 'Valid non-financial note',
            terms: 'Financial terms requiring version',
          });

        expect(res.status).toBe(400);
        expect(res.body.title).toBe('Validation Error');
        expect(res.body.detail).toMatch(/expectedVersion/i);

        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.notes).toBe('Initial notes');
        expect(inv.terms).toBe('Net 30 Initial');
      });

      it('accepts payload mixing financial and non-financial fields with valid expectedVersion', async () => {
        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${accountingToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            notes: 'Updated note together with terms',
            address: 'New address together with terms',
            terms: 'Net 90 Mixed',
            expectedVersion: 1,
          });

        expect(res.status).toBe(200);
        const inv = mockTables.invoices.get(INVOICE_ID);
        expect(inv.notes).toBe('Updated note together with terms');
        expect(inv.address).toBe('New address together with terms');
        expect(inv.terms).toBe('Net 90 Mixed');
        expect(inv.version).toBe(2);
      });

      it('allows an administrator financial edit on a released invoice with valid expectedVersion', async () => {
        // Set invoice to Sent
        const inv = mockTables.invoices.get(INVOICE_ID);
        inv.status = 'Sent';

        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            terms: 'Attempt to change terms on Sent invoice',
            expectedVersion: 1,
          });

        expect(res.status).toBe(200);
        expect(res.body.data.terms).toBe('Attempt to change terms on Sent invoice');
        expect(res.body.data.version).toBe(2);
      });

      it('allows non-financial edit (notes) on non-Draft invoice without expectedVersion', async () => {
        const inv = mockTables.invoices.get(INVOICE_ID);
        inv.status = 'Sent';

        const res = await request(app)
          .patch(`/v1/invoices/${INVOICE_ID}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            notes: 'Operational note on Sent invoice',
          });

        expect(res.status).toBe(200);
        expect(inv.notes).toBe('Operational note on Sent invoice');
      });
    });
  });
});
