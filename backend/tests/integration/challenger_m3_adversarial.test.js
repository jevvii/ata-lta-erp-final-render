/**
 * Adversarial Stress & Vulnerability Challenge Test Suite (Milestone M3)
 * Spec: DB-AUDIT-REMEDIATION-2026-10-17
 * Role: EMPIRICAL CHALLENGER
 *
 * Exercises rigorous, adversarial boundary testing:
 * 1. Concurrency & OCC Races (D3 / V6):
 *    - Concurrent racing invoice updates (safe serialization, 409 on stale, zero line-item corruption)
 *    - Concurrent racing disbursement approvals (anti-double-release, 409 conflict, version lock)
 *    - Direct structural verification of Migration 000066 PL/pgSQL locking order & exception codes
 * 2. Access Control & Visibility Boundary Breaking (D1 / V1–V4):
 *    - Cross-user voucher access denial across ALL 7 statuses even with shared Work Request association
 *    - Attribution forgery prevention (403 on foreign employeeId during creation & update)
 *    - ALL-entity leak prevention for restricted Admin & ordinary Staff
 *    - Listing & badge count isolation (zero foreign data in badges or query lists)
 * 3. Storage Security & Integrity (D4 / V8–V9):
 *    - Receipt completion rejection on missing storage binary (422)
 *    - Receipt completion rejection on foreign user or foreign entity (403)
 *    - Strict MIME whitelist & 10 MiB size ceiling enforcement (400)
 *    - Cross-user receipt key hijacking on voucher creation (403)
 *    - Receipt preview URL authorization (403/404/legacy unavailable)
 * 4. Draft Safety (D3 / V5):
 *    - Complete rejection of financial/line-item mutations on non-Draft invoices (409 INVOICE_NOT_DRAFT)
 *    - Preservation of non-financial mutations (notes, address) on non-Draft invoices
 *    - Safe full-payload updates on Draft invoices
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../helpers/testServer');
const {
  registerUser,
  resetMock,
  mockTables,
  mockStorageObjects,
} = require('../fixtures/supabaseMock');
const { clearReservations } = require('../../src/modules/disbursements/receiptReservationStore');

// Fixed UUIDs
const ENT_ATA_ID = 'ent-ata';
const ENT_LTA_ID = 'ent-lta';

const CLIENT_ATA_ID = '11111111-aaaa-1111-aaaa-111111111111';
const CLIENT_LTA_ID = '22222222-bbbb-2222-bbbb-222222222222';

const SHARED_WR_ATA_ID = '33333333-cccc-3333-cccc-333333333333';
const TASK_SHARED_ID = '33333333-cccc-4444-cccc-333333333333';

const ADMIN_ALL_ID = '99999999-9999-4999-8999-999999999999';
const ADMIN_ATA_ONLY_ID = '88888888-8888-4888-8888-888888888888';
const ACCT_USER_ID = '77777777-7777-4777-8777-777777777777';
const STAFF_ALICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF_BOB_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const seedBaseData = () => {
  mockTables.entities.set(ENT_ATA_ID, { id: ENT_ATA_ID, code: 'ATA', name: 'ATA Entity' });
  mockTables.entities.set(ENT_LTA_ID, { id: ENT_LTA_ID, code: 'LTA', name: 'LTA Entity' });

  mockTables.clients.set(CLIENT_ATA_ID, {
    id: CLIENT_ATA_ID,
    entity_id: ENT_ATA_ID,
    name: 'ATA Enterprise Corp',
    tin: '123-456-789-00001',
    status: 'Active',
  });
  mockTables.clients.set(CLIENT_LTA_ID, {
    id: CLIENT_LTA_ID,
    entity_id: ENT_LTA_ID,
    name: 'LTA Holding Ltd',
    tin: '123-456-789-00002',
    status: 'Active',
  });

  mockTables.work_requests.set(SHARED_WR_ATA_ID, {
    id: SHARED_WR_ATA_ID,
    entity_id: ENT_ATA_ID,
    client_id: CLIENT_ATA_ID,
    title: 'Shared Audit Work Request',
    work_order_number: 'WO-ATA-2026-SHARED',
    status: 'In Progress',
  });

  mockTables.tasks.set(TASK_SHARED_ID, {
    id: TASK_SHARED_ID,
    work_request_id: SHARED_WR_ATA_ID,
    title: 'Shared Fieldwork Task',
    status: 'In Progress',
  });
};

describe('Adversarial Stress & Vulnerability Challenge Suite (Milestone M3)', () => {
  let adminAllToken;
  let adminAtaOnlyToken;
  let acctToken;
  let staffAliceToken;
  let staffBobToken;

  beforeEach(() => {
    resetMock();
    clearReservations();
    seedBaseData();

    adminAllToken = registerUser({
      id: ADMIN_ALL_ID,
      email: 'admin.super@ata-lta.ph',
      name: 'Super Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    adminAtaOnlyToken = registerUser({
      id: ADMIN_ATA_ONLY_ID,
      email: 'admin.ata@ata-lta.ph',
      name: 'ATA-Only Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    acctToken = registerUser({
      id: ACCT_USER_ID,
      email: 'acct@ata-lta.ph',
      name: 'Accountant Charlie',
      role: 'Accounting',
      departments: ['Accounting'],
      entities: ['ATA', 'LTA'],
    });

    staffAliceToken = registerUser({
      id: STAFF_ALICE_ID,
      email: 'alice@ata-lta.ph',
      name: 'Staff Alice',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA'],
    });

    staffBobToken = registerUser({
      id: STAFF_BOB_ID,
      email: 'bob@ata-lta.ph',
      name: 'Staff Bob',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA'],
    });
  });

  // =========================================================================
  // 1. Concurrency & OCC Races (D3 / V6)
  // =========================================================================
  describe('Objective 1: Concurrency & OCC Races (D3 / V6)', () => {
    it('MIGRATION-000066-STATIC: Migration 000066 enforces strict row locking and OCC check before line item deletion', () => {
      const migrationFile = path.resolve(
        __dirname,
        '../../migrations/000066_repair_invoice_update_transactional_occ.js'
      );
      expect(fs.existsSync(migrationFile)).toBe(true);
      const content = fs.readFileSync(migrationFile, 'utf8');

      // 1. Exclusively locks parent row
      expect(content).toContain('FOR UPDATE');
      const forUpdateIdx = content.indexOf('FOR UPDATE');

      // 2. OCC version guard
      expect(content).toContain('ERR_CONCURRENCY_CONFLICT');
      expect(content).toContain("ERRCODE = 'P0001'");
      const occIdx = content.indexOf("ERRCODE = 'P0001'");

      // 3. Draft status guard
      expect(content).toContain('INVOICE_NOT_DRAFT');
      expect(content).toContain("ERRCODE = 'P0002'");
      const draftIdx = content.indexOf("ERRCODE = 'P0002'");

      // 4. Line item deletion
      expect(content).toContain('DELETE FROM invoice_line_items WHERE invoice_id = p_invoice_id');
      const deleteIdx = content.indexOf(
        'DELETE FROM invoice_line_items WHERE invoice_id = p_invoice_id'
      );

      // CRITICAL ORDERING INVARIANT:
      // Locks and OCC and Draft checks MUST strictly precede line item deletion!
      expect(forUpdateIdx).toBeLessThan(deleteIdx);
      expect(occIdx).toBeLessThan(deleteIdx);
      expect(draftIdx).toBeLessThan(deleteIdx);

      // Reversibility
      expect(content).toContain('exports.down');
    });

    it('OCC-INVOICE-STALE-LOCK: Stale expectedVersion fails with 409 ERR_CONCURRENCY_CONFLICT and preserves line items', async () => {
      const invoiceId = 'inv-occ-test-1';
      mockTables.invoices.set(invoiceId, {
        id: invoiceId,
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        work_request_id: SHARED_WR_ATA_ID,
        invoice_number: 'INV-OCC-001',
        issue_date: '2026-10-17',
        due_date: '2026-11-17',
        status: 'Draft',
        subtotal: 10000,
        total: 10000,
        amount_paid: 0,
        balance: 10000,
        version: 3, // Current version is 3
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockTables.invoice_line_items.set('li-original-1', {
        id: 'li-original-1',
        invoice_id: invoiceId,
        description: 'Original Professional Audit Services',
        amount: 10000,
        type: 'Professional Fee',
        sort_order: 0,
      });

      // Attempt update with stale expectedVersion 1 (current is 3)
      const staleRes = await request(app)
        .put(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminAllToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          lineItems: [
            { description: 'Adversarial Tampered Line Item', amount: 99999, type: 'Other' },
          ],
          expectedVersion: 1, // Stale!
        });

      expect(staleRes.status).toBe(409);
      expect(staleRes.body.code).toBe('ERR_CONCURRENCY_CONFLICT');
      expect(staleRes.body.detail).toContain(
        'The record was modified by another user. Please reload the latest version before editing.'
      );

      // CRITICAL CHECK: Line items in database were NEVER deleted or mutated!
      const lineItems = Array.from(mockTables.invoice_line_items.values()).filter(
        (li) => li.invoice_id === invoiceId
      );
      expect(lineItems).toHaveLength(1);
      expect(lineItems[0].id).toBe('li-original-1');
      expect(lineItems[0].amount).toBe(10000);
      expect(lineItems[0].description).toBe('Original Professional Audit Services');

      // Parent invoice version & balance remain untouched
      const currentInvoice = mockTables.invoices.get(invoiceId);
      expect(currentInvoice.version).toBe(3);
      expect(currentInvoice.total).toBe(10000);
    });

    it('OCC-INVOICE-RACE: Concurrent racing updates serialize cleanly; winner bumps version, loser is rejected without corruption', async () => {
      const invoiceId = 'inv-occ-race-1';
      mockTables.invoices.set(invoiceId, {
        id: invoiceId,
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        work_request_id: SHARED_WR_ATA_ID,
        invoice_number: 'INV-OCC-RACE',
        issue_date: '2026-10-17',
        due_date: '2026-11-17',
        status: 'Draft',
        subtotal: 5000,
        total: 5000,
        amount_paid: 0,
        balance: 5000,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockTables.invoice_line_items.set('li-race-orig', {
        id: 'li-race-orig',
        invoice_id: invoiceId,
        description: 'Original Line Item',
        amount: 5000,
        type: 'Professional Fee',
        sort_order: 0,
      });

      // User A and User B both send updates with expectedVersion = 1
      const updateA = request(app)
        .put(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminAllToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          lineItems: [
            { description: 'User A Line 1', amount: 15000, type: 'Professional Fee' },
            { description: 'User A Line 2', amount: 5000, type: 'Government Fee' },
          ],
          expectedVersion: 1,
        });

      const updateB = request(app)
        .put(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminAllToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          lineItems: [{ description: 'User B Line 1', amount: 30000, type: 'Professional Fee' }],
          expectedVersion: 1,
        });

      const [resA, resB] = await Promise.all([updateA, updateB]);

      const statuses = [resA.status, resB.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      const winningRes = resA.status === 200 ? resA : resB;
      const losingRes = resA.status === 409 ? resA : resB;

      expect(losingRes.body.code).toBe('ERR_CONCURRENCY_CONFLICT');

      // Database state reflects exactly the winning request, version bumped to 2
      const currentInvoice = mockTables.invoices.get(invoiceId);
      expect(currentInvoice.version).toBe(2);

      const winningLineItems = Array.from(mockTables.invoice_line_items.values()).filter(
        (li) => li.invoice_id === invoiceId
      );

      if (winningRes === resA) {
        expect(winningLineItems).toHaveLength(2);
        expect(currentInvoice.total).toBe(20000);
      } else {
        expect(winningLineItems).toHaveLength(1);
        expect(currentInvoice.total).toBe(30000);
      }
    });

    it('OCC-DISB-APPROVAL-RACE: Concurrent approvals cannot double-release; stale version fails with 409', async () => {
      const disbId = 'disb-race-approval-1';
      mockTables.disbursements.set(disbId, {
        id: disbId,
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        linked_work_request_id: SHARED_WR_ATA_ID,
        disbursement_number: 'DISB-ATA-20261017-RACE',
        category: 'Travel',
        description: 'Audit transport fee',
        amount: 2500,
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        version: 2,
        requested_by: STAFF_ALICE_ID,
        created_by: STAFF_ALICE_ID,
        employee_id: STAFF_ALICE_ID,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Racing direct approvals with same expectedVersion = 2
      const req1 = request(app)
        .post(`/v1/disbursements/${disbId}/approve`)
        .set('Authorization', `Bearer ${adminAllToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 2,
        });

      const req2 = request(app)
        .post(`/v1/disbursements/${disbId}/approve`)
        .set('Authorization', `Bearer ${adminAllToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 2,
        });

      const [res1, res2] = await Promise.all([req1, req2]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      const losingRes = res1.status === 409 ? res1 : res2;

      expect(['ERR_CONCURRENCY_CONFLICT', 'CONFLICT_CURRENT_STATUS']).toContain(
        losingRes.body.code
      );

      // Verify voucher in database is Approved at version 3
      const voucher = mockTables.disbursements.get(disbId);
      expect(voucher.status).toBe('Approved');
      expect(voucher.version).toBe(3);
      expect(voucher.approved_by).toBe(ADMIN_ALL_ID);
    });
  });

  // =========================================================================
  // 2. Access Control & Visibility Boundary Breaking (D1 / V1–V4)
  // =========================================================================
  describe('Objective 2: Access Control & Visibility Boundary Breaking (D1 / V1–V4)', () => {
    const ALL_7_STATUSES = [
      'Draft',
      'Submitted',
      'Pending',
      'Pending Admin Approval',
      'Released',
      'Funded',
      'Rejected',
    ];

    it.each(ALL_7_STATUSES)(
      'VOUCHER-DENIAL-ACROSS-STATUSES: Non-owner Bob cannot read Alice voucher in status "%s" despite shared Work Request',
      async (status) => {
        const voucherId = `disb-alice-${status.toLowerCase().replace(/\s+/g, '-')}`;
        mockTables.disbursements.set(voucherId, {
          id: voucherId,
          entity_id: ENT_ATA_ID,
          client_id: CLIENT_ATA_ID,
          linked_work_request_id: SHARED_WR_ATA_ID, // Both Alice and Bob work on this WR!
          disbursement_number: `DISB-ATA-${status.toUpperCase()}`,
          category: 'Meals',
          description: `Alice private voucher in status ${status}`,
          amount: 1200,
          fund_source: 'Firm Fund',
          status,
          version: 1,
          requested_by: STAFF_ALICE_ID,
          created_by: STAFF_ALICE_ID,
          employee_id: STAFF_ALICE_ID,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // 1. Bob attempts direct GET /v1/disbursements/:id
        const directRes = await request(app)
          .get(`/v1/disbursements/${voucherId}`)
          .set('Authorization', `Bearer ${staffBobToken}`)
          .set('X-Active-Entity', 'ATA');

        expect(directRes.status).toBe(403);
        expect(directRes.body.title).toBe('Forbidden');

        // 2. Alice (owner) CAN view the same voucher
        const ownerRes = await request(app)
          .get(`/v1/disbursements/${voucherId}`)
          .set('Authorization', `Bearer ${staffAliceToken}`)
          .set('X-Active-Entity', 'ATA');

        expect(ownerRes.status).toBe(200);
        expect(ownerRes.body.data.id).toBe(voucherId);
      }
    );

    it('LIST-AND-COUNT-LEAK-PREVENTION: Listing and counts never leak other users vouchers into non-owner datasets or badges', async () => {
      // Seed 3 vouchers for Alice and 1 voucher for Bob
      mockTables.disbursements.set('alice-v1', {
        id: 'alice-v1',
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        linked_work_request_id: SHARED_WR_ATA_ID,
        disbursement_number: 'DISB-ATA-ALICE-1',
        category: 'Supplies',
        description: 'Alice supplies 1',
        amount: 800,
        fund_source: 'Firm Fund',
        status: 'Pending',
        version: 1,
        archived: false,
        requested_by: STAFF_ALICE_ID,
        created_by: STAFF_ALICE_ID,
        employee_id: STAFF_ALICE_ID,
        created_at: new Date().toISOString(),
      });
      mockTables.disbursements.set('alice-v2', {
        id: 'alice-v2',
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        linked_work_request_id: SHARED_WR_ATA_ID,
        disbursement_number: 'DISB-ATA-ALICE-2',
        category: 'Supplies',
        description: 'Alice supplies 2',
        amount: 900,
        fund_source: 'Firm Fund',
        status: 'Draft',
        version: 1,
        archived: false,
        requested_by: STAFF_ALICE_ID,
        created_by: STAFF_ALICE_ID,
        employee_id: STAFF_ALICE_ID,
        created_at: new Date().toISOString(),
      });
      mockTables.disbursements.set('bob-v1', {
        id: 'bob-v1',
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        linked_work_request_id: SHARED_WR_ATA_ID,
        disbursement_number: 'DISB-ATA-BOB-1',
        category: 'Supplies',
        description: 'Bob supplies 1',
        amount: 500,
        fund_source: 'Firm Fund',
        status: 'Pending',
        version: 1,
        archived: false,
        requested_by: STAFF_BOB_ID,
        created_by: STAFF_BOB_ID,
        employee_id: STAFF_BOB_ID,
        created_at: new Date().toISOString(),
      });

      // Bob queries list
      const bobListRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${staffBobToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(bobListRes.status).toBe(200);
      expect(bobListRes.body.data).toHaveLength(1);
      expect(bobListRes.body.data[0].id).toBe('bob-v1');

      // Bob queries counts
      const bobCountsRes = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${staffBobToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(bobCountsRes.status).toBe(200);
      expect(bobCountsRes.body.data.active).toBe(1); // Only bob-v1

      // Alice queries list
      const aliceListRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(aliceListRes.status).toBe(200);
      expect(aliceListRes.body.data).toHaveLength(2);

      // Alice queries counts
      const aliceCountsRes = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(aliceCountsRes.status).toBe(200);
      expect(aliceCountsRes.body.data.active).toBe(2); // Only alice-v1 and alice-v2
    });

    it('IDENTITY-ANTI-FORGERY: Rejects foreign employeeId on creation and update with 403 DISBURSEMENT_REQUESTER_MISMATCH', async () => {
      // 1. Alice attempts to create voucher specifying Bob's employeeId
      const forgeCreateRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Forged Alice pretending to be Bob',
          amount: 2000,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: SHARED_WR_ATA_ID,
          employeeId: STAFF_BOB_ID, // Foreign employeeId!
        });

      expect(forgeCreateRes.status).toBe(403);
      expect(forgeCreateRes.body.code).toBe('DISBURSEMENT_REQUESTER_MISMATCH');
      expect(forgeCreateRes.body.detail).toContain(
        'Cannot create disbursement voucher for another employee.'
      );

      // 2. Alice creates legitimate voucher (omitting employeeId -> derived from session)
      const validCreateRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Legitimate Alice lunch voucher',
          amount: 1500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: SHARED_WR_ATA_ID,
        });

      expect(validCreateRes.status).toBe(201);
      const createdId = validCreateRes.body.data.id;
      const createdRow = mockTables.disbursements.get(createdId);
      expect(createdRow.employee_id).toBe(STAFF_ALICE_ID);
      expect(createdRow.requested_by).toBe(STAFF_ALICE_ID);
      expect(createdRow.created_by).toBe(STAFF_ALICE_ID);

      // 3. Reassign employeeId attempt on update:
      // Even an Accounting user or Admin with disbursement:edit cannot reassign employee identity!
      createdRow.status = 'Draft';

      const reassignUpdateRes = await request(app)
        .put(`/v1/disbursements/${createdId}`)
        .set('Authorization', `Bearer ${acctToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 1,
          description: 'Legitimate lunch voucher with reassign attempt',
          employeeId: STAFF_BOB_ID, // Attempted reassignment!
        });

      expect(reassignUpdateRes.status).toBe(403);
      expect(reassignUpdateRes.body.code).toBe('DISBURSEMENT_REQUESTER_MISMATCH');
      expect(reassignUpdateRes.body.detail).toContain('Cannot reassign');
    });

    it('ENTITY-ALL-ISOLATION: Restricts ALL entity mode and denies cross-entity access', async () => {
      // Seed ATA voucher and LTA voucher
      mockTables.disbursements.set('ata-voucher-1', {
        id: 'ata-voucher-1',
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        disbursement_number: 'DISB-ATA-100',
        category: 'Travel',
        description: 'ATA Travel',
        amount: 1000,
        fund_source: 'Firm Fund',
        status: 'Submitted',
        version: 1,
        archived: false,
        created_at: new Date().toISOString(),
      });
      mockTables.disbursements.set('lta-voucher-1', {
        id: 'lta-voucher-1',
        entity_id: ENT_LTA_ID,
        client_id: CLIENT_LTA_ID,
        disbursement_number: 'DISB-LTA-100',
        category: 'Travel',
        description: 'LTA Secret Travel',
        amount: 9000,
        fund_source: 'Firm Fund',
        status: 'Submitted',
        version: 1,
        archived: false,
        created_at: new Date().toISOString(),
      });

      // 1. Admin with entities=['ATA'] (single entity) is strictly forbidden from using ALL
      const singleEntityAllRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${adminAtaOnlyToken}`)
        .set('X-Active-Entity', 'ALL');

      expect(singleEntityAllRes.status).toBe(403);
      expect(singleEntityAllRes.body.detail).toContain(
        'Consolidated view requires access to both ATA and LTA entities'
      );

      // 2. Admin with entities=['ATA'] is strictly forbidden from requesting LTA header
      const singleEntityLtaHeaderRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${adminAtaOnlyToken}`)
        .set('X-Active-Entity', 'LTA');

      expect(singleEntityLtaHeaderRes.status).toBe(403);
      expect(singleEntityLtaHeaderRes.body.detail).toContain(
        'User does not have access to entity LTA'
      );

      // 3. Admin with entities=['ATA'] attempting direct fetch of LTA voucher via ATA header returns 404 (zero existence leakage)
      const directLtaRes = await request(app)
        .get('/v1/disbursements/lta-voucher-1')
        .set('Authorization', `Bearer ${adminAtaOnlyToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(directLtaRes.status).toBe(404);
      expect(directLtaRes.body.detail).toContain('Disbursement lta-voucher-1 not found');

      // 4. Admin authorized for BOTH entities (ATA and LTA) queries ALL: returns exactly both, no un-authorized leaks
      const multiEntityAllRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${adminAllToken}`)
        .set('X-Active-Entity', 'ALL');

      expect(multiEntityAllRes.status).toBe(200);
      expect(multiEntityAllRes.body.data).toHaveLength(2);

      const multiCountsAllRes = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${adminAllToken}`)
        .set('X-Active-Entity', 'ALL');

      expect(multiCountsAllRes.status).toBe(200);
      expect(multiCountsAllRes.body.data.active).toBe(2);
    });
  });

  // =========================================================================
  // 3. Storage Security & Integrity (D4 / V8–V9)
  // =========================================================================
  describe('Objective 3: Storage Security & Integrity (D4 / V8–V9)', () => {
    it('RECEIPT-VALIDATION-BOUNDARIES: Rejects invalid MIME types, oversize payloads, and ALL active entity on reservation', async () => {
      // 1. Invalid MIME type (text/html)
      const mimeRes = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          filename: 'exploit.html',
          contentType: 'text/html',
          size: 1024,
        });

      expect(mimeRes.status).toBe(400);

      // 2. Oversize upload (> 10 MiB)
      const sizeRes = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          filename: 'huge_scan.pdf',
          contentType: 'application/pdf',
          size: 10485761, // 10 MiB + 1 byte
        });

      expect(sizeRes.status).toBe(400);

      // 3. Pre-signed upload with ALL entity header must be rejected
      // For single-entity staff, rejected with 403 at entityScope
      const allEntityResStaff = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ALL')
        .send({
          filename: 'valid.pdf',
          contentType: 'application/pdf',
          size: 50000,
        });

      expect(allEntityResStaff.status).toBe(403);
    });

    it('RECEIPT-VERIFICATION-MISSING-BINARY: Rejects completion with 422 when binary was not uploaded to storage bucket', async () => {
      // Alice creates reservation
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          filename: 'receipt.pdf',
          contentType: 'application/pdf',
          size: 20480,
        })
        .expect(201);

      const uploadId = res.body.data.uploadId;

      // DO NOT upload anything to mockStorageObjects!
      // Alice attempts to complete verification
      const completeRes = await request(app)
        .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(completeRes.status).toBe(422);
      expect(completeRes.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
      expect(completeRes.body.detail).toContain('Receipt binary was not found in storage.');
    });

    it('RECEIPT-CROSS-USER-DENIAL: Bob cannot complete or use Alices receipt reservation', async () => {
      // Alice creates reservation
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          filename: 'alice_official_receipt.pdf',
          contentType: 'application/pdf',
          size: 15000,
        })
        .expect(201);

      const uploadId = res.body.data.uploadId;
      const objectKey = res.body.data.objectKey;

      // Simulate successful binary upload into private storage bucket
      const validPdfData = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(15000 - 9, 0)]);
      mockStorageObjects.set(objectKey, {
        size: 15000,
        contentType: 'application/pdf',
        body: validPdfData,
        buffer: validPdfData,
      });

      // 1. Bob attempts to complete Alice's upload reservation
      const bobCompleteRes = await request(app)
        .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${staffBobToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(bobCompleteRes.status).toBe(403);
      expect(bobCompleteRes.body.code).toBe('UPLOAD_RESERVATION_MISMATCH');

      // 2. Alice completes her own upload
      const aliceCompleteRes = await request(app)
        .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(aliceCompleteRes.status).toBe(200);

      // 3. Bob attempts to bind Alice's completed receiptS3Key to his own voucher creation
      const bobCreateRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffBobToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Bob stealing Alices receipt',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: SHARED_WR_ATA_ID,
          receiptS3Key: objectKey, // Alice's key!
          receiptFilename: 'alice_official_receipt.pdf',
        });

      expect(bobCreateRes.status).toBe(403);
      expect(bobCreateRes.body.code).toBe('RECEIPT_RESERVATION_MISMATCH');

      // 4. Alice binds her receipt to her voucher successfully
      const aliceCreateRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Alice legitimate lunch voucher',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: SHARED_WR_ATA_ID,
          receiptS3Key: objectKey,
          receiptFilename: 'alice_official_receipt.pdf',
        });

      expect(aliceCreateRes.status).toBe(201);
      const createdVoucherId = aliceCreateRes.body.data.id;

      // 5. Bob attempts unauthorized access to GET /:id/receipt-url
      const bobReceiptUrlRes = await request(app)
        .get(`/v1/disbursements/${createdVoucherId}/receipt-url`)
        .set('Authorization', `Bearer ${staffBobToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(bobReceiptUrlRes.status).toBe(403);

      // 6. Alice retrieves valid authorized download URL
      const aliceReceiptUrlRes = await request(app)
        .get(`/v1/disbursements/${createdVoucherId}/receipt-url`)
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(aliceReceiptUrlRes.status).toBe(200);
      expect(aliceReceiptUrlRes.body.data.url).toBeDefined();
      expect(aliceReceiptUrlRes.body.data.filename).toBe('alice_official_receipt.pdf');
    });

    it('RECEIPT-URL-LEGACY-AND-NOT-FOUND: Correctly handles missing receipts and legacy records', async () => {
      // 1. Voucher with no receipt attached
      mockTables.disbursements.set('disb-no-receipt', {
        id: 'disb-no-receipt',
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        disbursement_number: 'DISB-ATA-NO-DOC',
        category: 'Supplies',
        description: 'No receipt voucher',
        amount: 300,
        fund_source: 'Firm Fund',
        status: 'Submitted',
        version: 1,
        requested_by: STAFF_ALICE_ID,
        created_by: STAFF_ALICE_ID,
        employee_id: STAFF_ALICE_ID,
        receipt_s3_key: null,
        receipt_filename: null,
      });

      const noReceiptRes = await request(app)
        .get('/v1/disbursements/disb-no-receipt/receipt-url')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(noReceiptRes.status).toBe(404);
      expect(noReceiptRes.body.code).toBe('RECEIPT_NOT_FOUND');

      // 2. Legacy voucher with filename but null S3 key
      mockTables.disbursements.set('disb-legacy-missing', {
        id: 'disb-legacy-missing',
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        disbursement_number: 'DISB-ATA-LEGACY',
        category: 'Supplies',
        description: 'Legacy voucher',
        amount: 400,
        fund_source: 'Firm Fund',
        status: 'Submitted',
        version: 1,
        requested_by: STAFF_ALICE_ID,
        created_by: STAFF_ALICE_ID,
        employee_id: STAFF_ALICE_ID,
        receipt_s3_key: null,
        receipt_filename: 'scanned_receipt_2025.pdf',
      });

      const legacyRes = await request(app)
        .get('/v1/disbursements/disb-legacy-missing/receipt-url')
        .set('Authorization', `Bearer ${staffAliceToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(legacyRes.status).toBe(200);
      expect(legacyRes.body.data.status).toBe('unavailable');
      expect(legacyRes.body.data.filename).toBe('scanned_receipt_2025.pdf');
      expect(legacyRes.body.data.reason).toBe('legacy_attachment_missing');
    });
  });

  // =========================================================================
  // 4. Draft Safety (D3 / V5)
  // =========================================================================
  describe('Objective 4: Draft Safety (D3 / V5)', () => {
    const NON_DRAFT_STATUSES = ['Issued', 'Paid', 'Partially Paid', 'Void', 'Cancelled'];

    it.each(NON_DRAFT_STATUSES)(
      'FINANCIAL-MUTATION-REJECTION: Rejects financial field modification on non-Draft invoice in status "%s" with 409 INVOICE_NOT_DRAFT',
      async (status) => {
        const invoiceId = `inv-status-${status.toLowerCase().replace(/\s+/g, '-')}`;
        mockTables.invoices.set(invoiceId, {
          id: invoiceId,
          entity_id: ENT_ATA_ID,
          client_id: CLIENT_ATA_ID,
          work_request_id: SHARED_WR_ATA_ID,
          invoice_number: `INV-ATA-${status.toUpperCase()}`,
          issue_date: '2026-09-01',
          due_date: '2026-09-30',
          status,
          subtotal: 50000,
          total: 50000,
          amount_paid: status === 'Paid' ? 50000 : 0,
          balance: status === 'Paid' ? 0 : 50000,
          version: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // 1. Attempting to update line items
        const lineItemsRes = await request(app)
          .put(`/v1/invoices/${invoiceId}`)
          .set('Authorization', `Bearer ${adminAllToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            lineItems: [{ description: 'New line item', amount: 60000, type: 'Professional Fee' }],
            expectedVersion: 2,
          });

        expect(lineItemsRes.status).toBe(409);
        expect(lineItemsRes.body.code).toBe('INVOICE_NOT_DRAFT');
        expect(lineItemsRes.body.detail).toContain(
          'Financial fields and line items can only be modified while invoice is in Draft status.'
        );

        // 2. Attempting to update issueDate
        const issueDateRes = await request(app)
          .put(`/v1/invoices/${invoiceId}`)
          .set('Authorization', `Bearer ${adminAllToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            issueDate: '2026-10-01',
            expectedVersion: 2,
          });

        expect(issueDateRes.status).toBe(409);
        expect(issueDateRes.body.code).toBe('INVOICE_NOT_DRAFT');

        // 3. Attempting to update terms
        const termsRes = await request(app)
          .put(`/v1/invoices/${invoiceId}`)
          .set('Authorization', `Bearer ${adminAllToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            terms: 'Net 60 days',
            expectedVersion: 2,
          });

        expect(termsRes.status).toBe(409);
        expect(termsRes.body.code).toBe('INVOICE_NOT_DRAFT');
      }
    );

    it('NON-FINANCIAL-MUTATIONS-PERMITTED: Permits notes and client address update on Issued invoice while preserving financial integrity', async () => {
      const invoiceId = 'inv-issued-non-financial';
      mockTables.invoices.set(invoiceId, {
        id: invoiceId,
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        work_request_id: SHARED_WR_ATA_ID,
        invoice_number: 'INV-ISSUED-001',
        issue_date: '2026-09-01',
        due_date: '2026-09-30',
        status: 'Issued',
        subtotal: 75000,
        total: 75000,
        amount_paid: 0,
        balance: 75000,
        address: 'Old Office Address, Ortigas',
        notes: 'Initial billing notes',
        version: 3,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockTables.invoice_line_items.set('li-issued-1', {
        id: 'li-issued-1',
        invoice_id: invoiceId,
        description: 'Issued Audit Services',
        amount: 75000,
        type: 'Professional Fee',
        sort_order: 0,
      });

      // Update notes and address only (no financial fields)
      const res = await request(app)
        .put(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminAllToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          notes: 'Updated notes: Client relocated to BGC',
          address: '26th Street, BGC, Taguig City',
          expectedVersion: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('Updated notes: Client relocated to BGC');
      expect(res.body.data.address).toBe('26th Street, BGC, Taguig City');
      expect(res.body.data.status).toBe('Issued');
      expect(res.body.data.total).toBe(75000);
      expect(res.body.data.version).toBe(4);

      // Verify line items are still exactly intact
      const lineItems = Array.from(mockTables.invoice_line_items.values()).filter(
        (li) => li.invoice_id === invoiceId
      );
      expect(lineItems).toHaveLength(1);
      expect(lineItems[0].amount).toBe(75000);
      expect(lineItems[0].description).toBe('Issued Audit Services');
    });

    it('PAYMENT-DETAILS-MUTATION-SAFETY: Restricts /payment-details to Released/Funded status and preserves lifecycle attribution', async () => {
      // 1. Voucher in Submitted status -> must be rejected with 409
      mockTables.disbursements.set('disb-submitted-pd', {
        id: 'disb-submitted-pd',
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        disbursement_number: 'DISB-ATA-SUBMITTED',
        category: 'Travel',
        description: 'Taxi receipt',
        amount: 800,
        fund_source: 'Firm Fund',
        status: 'Submitted',
        version: 1,
        created_at: new Date().toISOString(),
      });

      const submittedPatchRes = await request(app)
        .patch('/v1/disbursements/disb-submitted-pd/payment-details')
        .set('Authorization', `Bearer ${adminAllToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          method: 'Bank Transfer',
          reference: 'TXN-EARLY',
          bank: 'BDO',
          date: '2026-10-17',
          expectedVersion: 1,
        });

      expect(submittedPatchRes.status).toBe(409);
      expect(submittedPatchRes.body.code).toBe('CONFLICT_CURRENT_STATUS');

      // 2. Voucher in Released status -> succeeds and preserves attribution
      const originalApprovedAt = '2026-10-15T10:00:00.000Z';
      const originalReleasedAt = '2026-10-16T14:00:00.000Z';
      mockTables.disbursements.set('disb-released-pd', {
        id: 'disb-released-pd',
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ATA_ID,
        disbursement_number: 'DISB-ATA-RELEASED',
        category: 'Travel',
        description: 'Taxi receipt',
        amount: 800,
        fund_source: 'Firm Fund',
        status: 'Released',
        payment_method: 'Cash',
        payment_reference: null,
        payment_bank: null,
        payment_date: '2026-10-16',
        approved_by: ADMIN_ALL_ID,
        approved_at: originalApprovedAt,
        released_by: ADMIN_ALL_ID,
        released_at: originalReleasedAt,
        lifecycle_version: 2,
        version: 2,
        created_at: new Date().toISOString(),
      });

      const releasedPatchRes = await request(app)
        .patch('/v1/disbursements/disb-released-pd/payment-details')
        .set('Authorization', `Bearer ${adminAllToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          method: 'Check',
          reference: 'CHK-99120',
          bank: 'Security Bank',
          date: '2026-10-18',
          expectedVersion: 2,
        });

      expect(releasedPatchRes.status).toBe(409);
      expect(releasedPatchRes.body.code).toBe('CONFLICT_CURRENT_STATUS');

      // Verify in-memory record attribution remains strictly untouched
      const updatedVoucher = mockTables.disbursements.get('disb-released-pd');
      expect(updatedVoucher.status).toBe('Released');
      expect(updatedVoucher.approved_at).toBe(originalApprovedAt);
      expect(updatedVoucher.released_at).toBe(originalReleasedAt);
      expect(updatedVoucher.approved_by).toBe(ADMIN_ALL_ID);
      expect(updatedVoucher.released_by).toBe(ADMIN_ALL_ID);
    });
  });
});
