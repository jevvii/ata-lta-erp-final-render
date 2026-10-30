/**
 * Integration tests for Disbursement ↔ Invoice & Transmittal Connectivity:
 * - Cascading OCC version increments & status_history audit entries on auto-linked records
 * - Double-billing conflict guard (409 DISBURSEMENT_ALREADY_BILLED)
 * - Stale expectedVersion 409 Conflict on PATCH /v1/disbursements/:id after side-effect linking
 * - Direct link updates via PATCH /v1/disbursements/:id appending status_history entries
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

jest.mock('../../src/services/storageService', () => ({
  getSignedReadUrl: jest.fn().mockResolvedValue('https://s3.mock/signed-url'),
  uploadBuffer: jest.fn().mockResolvedValue('invoices/ent-ata/inv-1.pdf'),
  headObject: jest.fn().mockResolvedValue({ ContentLength: 1024, ContentType: 'application/pdf' }),
}));

jest.mock('../../src/services/pdfService', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
}));

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const WORK_REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const DISB_1 = '44444444-4444-4444-8444-444444444444';
const DISB_2 = '55555555-5555-4555-8555-555555555555';
const ADMIN_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('Disbursement ↔ Invoice & Transmittal Cascading OCC & Double-Billing Guard', () => {
  let adminToken;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    adminToken = registerUser({
      id: ADMIN_USER_ID,
      email: 'admin-occ-links@ata-lta.ph',
      name: 'Admin OCC Links',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: 'ent-ata',
      name: 'Acme Corporation',
      email: 'billing@acme.ph',
      deleted_at: null,
    });

    mockTables.work_requests.set(WORK_REQUEST_ID, {
      id: WORK_REQUEST_ID,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'Annual Corporate Compliance',
      work_order_number: 'WO-ATA-2026-0100',
      status: 'In Progress',
      creation_approval_status: 'approved',
      assigned_to: ADMIN_USER_ID,
      created_by: ADMIN_USER_ID,
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_ID, {
      id: TASK_ID,
      work_request_id: WORK_REQUEST_ID,
      title: 'SEC & BIR Filing Task',
      status: 'In Progress',
      approval_status: 'approved',
      assignee_id: ADMIN_USER_ID,
      deleted_at: null,
    });

    mockTables.disbursements.set(DISB_1, {
      id: DISB_1,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      linked_work_request_id: WORK_REQUEST_ID,
      linked_task_id: TASK_ID,
      task_id: TASK_ID,
      disbursement_number: 'DISB-ATA-20261029-0001',
      category: 'Government Fee',
      description: 'SEC Filing Fee',
      amount: 3500,
      fund_source: 'Client Fund',
      status: 'Released',
      lifecycle_version: 2,
      review_ready: true,
      version: 1,
      status_history: [
        {
          status: 'Released',
          by: ADMIN_USER_ID,
          at: '2026-10-28T10:00:00.000Z',
          action: 'released',
        },
      ],
      created_by: ADMIN_USER_ID,
      requested_by: ADMIN_USER_ID,
      archived: false,
      deleted_at: null,
    });

    mockTables.disbursements.set(DISB_2, {
      id: DISB_2,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      linked_work_request_id: WORK_REQUEST_ID,
      linked_task_id: TASK_ID,
      task_id: TASK_ID,
      disbursement_number: 'DISB-ATA-20261029-0002',
      category: 'Transportation',
      description: 'Messenger Service to BIR',
      amount: 600,
      fund_source: 'Firm Fund',
      status: 'Approved',
      lifecycle_version: 2,
      review_ready: true,
      version: 2,
      status_history: [],
      created_by: ADMIN_USER_ID,
      requested_by: ADMIN_USER_ID,
      archived: false,
      deleted_at: null,
    });
  });

  it('bumps disbursement version and appends invoice_linked to status_history when auto-linked via POST /v1/invoices', async () => {
    const res = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WORK_REQUEST_ID,
        taskId: TASK_ID,
        invoiceNumber: 'ATA-SI-2026-OCC-001',
        issueDate: '2026-10-29',
        dueDate: '2026-11-29',
        status: 'Draft',
        lineItems: [
          { description: 'Professional Retainer Fee', amount: 15000, type: 'Professional Fee' },
          { description: 'SEC Filing Fee Reimbursement', amount: 3500, type: 'Government Fee' },
        ],
        linkedDisbursementIds: [DISB_1],
      })
      .expect(201);

    const invoiceId = res.body.data.id;
    const updatedDisb = mockTables.disbursements.get(DISB_1);

    expect(updatedDisb.linked_invoice_id).toBe(invoiceId);
    expect(updatedDisb.version).toBe(2); // incremented from 1 -> 2
    const historyEntries = [...mockTables.status_history.values()].filter(
      (h) => h.table_name === 'disbursements' && h.record_id === DISB_1
    );
    expect(historyEntries.length).toBeGreaterThan(0);
    const lastEntry = historyEntries[historyEntries.length - 1];
    expect(lastEntry.details).toMatchObject({
      status: 'Released',
      by: ADMIN_USER_ID,
      action: 'invoice_linked',
      linked_invoice_id: invoiceId,
    });
  });

  it('returns 409 Conflict (DISBURSEMENT_ALREADY_BILLED) when attempting to POST /v1/invoices with a disbursement already linked to an active invoice', async () => {
    // First invoice links DISB_1
    const firstInvRes = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WORK_REQUEST_ID,
        taskId: TASK_ID,
        invoiceNumber: 'ATA-SI-2026-OCC-FIRST',
        issueDate: '2026-10-29',
        dueDate: '2026-11-29',
        status: 'Draft',
        lineItems: [{ description: 'SEC Filing Reimbursement', amount: 3500 }],
        linkedDisbursementIds: [DISB_1],
      })
      .expect(201);

    expect(mockTables.disbursements.get(DISB_1).linked_invoice_id).toBe(firstInvRes.body.data.id);

    // Second invoice attempts to bill the same DISB_1 while first invoice is still active
    const conflictRes = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WORK_REQUEST_ID,
        taskId: TASK_ID,
        invoiceNumber: 'ATA-SI-2026-OCC-SECOND',
        issueDate: '2026-10-29',
        dueDate: '2026-11-29',
        status: 'Draft',
        lineItems: [{ description: 'Duplicate SEC Filing Reimbursement', amount: 3500 }],
        linkedDisbursementIds: [DISB_1],
      })
      .expect(409);

    expect(conflictRes.body.code).toBe('DISBURSEMENT_ALREADY_BILLED');
    expect(conflictRes.body.detail).toContain(DISB_1);

    // Updating the SAME first invoice with its own already-linked DISB_1 is allowed (no self-conflict)
    await request(app)
      .put(`/v1/invoices/${firstInvRes.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        notes: 'Keep same disbursement linked',
        linkedDisbursementIds: [DISB_1],
      })
      .expect(200);

    // If the first invoice is Cancelled, DISB_1 can be re-billed on a new invoice
    mockTables.invoices.get(firstInvRes.body.data.id).status = 'Cancelled';
    const rebillRes = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WORK_REQUEST_ID,
        taskId: TASK_ID,
        invoiceNumber: 'ATA-SI-2026-OCC-REBILL',
        issueDate: '2026-10-29',
        dueDate: '2026-11-29',
        status: 'Draft',
        lineItems: [{ description: 'Replacement SEC Filing Reimbursement', amount: 3500 }],
        linkedDisbursementIds: [DISB_1],
      })
      .expect(201);

    expect(mockTables.disbursements.get(DISB_1).linked_invoice_id).toBe(rebillRes.body.data.id);
    expect(mockTables.disbursements.get(DISB_1).version).toBe(3);
  });

  it('bumps both disbursement version (with status_history) and invoice version when auto-linked via POST /v1/transmittals', async () => {
    const invoiceId = '66666666-6666-4666-8666-666666666666';
    mockTables.invoices.set(invoiceId, {
      id: invoiceId,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      work_request_id: WORK_REQUEST_ID,
      task_id: TASK_ID,
      linked_task_id: TASK_ID,
      invoice_number: 'ATA-SI-2026-TR-CASCADE',
      status: 'Sent',
      total: 12000,
      amount_paid: 0,
      balance: 12000,
      issue_date: '2026-10-29',
      due_date: '2026-11-29',
      version: 1,
      archived: false,
      deleted_at: null,
    });

    expect(mockTables.invoices.get(invoiceId).version).toBe(1);
    expect(mockTables.disbursements.get(DISB_2).version).toBe(2);

    // Create a transmittal that auto-links DISB_2 and invoiceId
    const trRes = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WORK_REQUEST_ID,
        linkedTaskId: TASK_ID,
        trackingNumber: 'TR-ATA-2026-CASCADE-01',
        recipientName: 'Acme Corp Accounting',
        items: [{ description: 'Original BIR Receipt & Billing Statement', quantity: 1 }],
        linkedDisbursementIds: [DISB_2],
        linkedInvoiceIds: [invoiceId],
      })
      .expect(201);

    const transmittalId = trRes.body.data.id;

    // Disbursement version bumped 2 -> 3 and status_history has transmittal_linked
    const updatedDisb = mockTables.disbursements.get(DISB_2);
    expect(updatedDisb.linked_transmittal_id).toBe(transmittalId);
    expect(updatedDisb.version).toBe(3);
    const transmittalHistory = [...mockTables.status_history.values()].filter(
      (h) => h.table_name === 'disbursements' && h.record_id === DISB_2
    );
    expect(transmittalHistory.length).toBeGreaterThan(0);
    const lastTransmittalEntry = transmittalHistory[transmittalHistory.length - 1];
    expect(lastTransmittalEntry.details).toMatchObject({
      status: 'Approved',
      by: ADMIN_USER_ID,
      action: 'transmittal_linked',
      linked_transmittal_id: transmittalId,
    });

    // Invoice version bumped 1 -> 2 and linked_transmittal_id set
    const updatedInv = mockTables.invoices.get(invoiceId);
    expect(updatedInv.linked_transmittal_id).toBe(transmittalId);
    expect(updatedInv.version).toBe(2);
  });

  it('rejects stale expectedVersion with 409 Conflict on PATCH /v1/disbursements/:id after side-effect linking bumped version, and succeeds with fresh version appending links_updated to status_history', async () => {
    // DISB_1 starts at version 1
    expect(mockTables.disbursements.get(DISB_1).version).toBe(1);

    // Side-effect link via POST /v1/invoices bumps DISB_1 version from 1 -> 2
    const invRes = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WORK_REQUEST_ID,
        taskId: TASK_ID,
        invoiceNumber: 'ATA-SI-2026-STALE-CHECK',
        issueDate: '2026-10-29',
        dueDate: '2026-11-29',
        status: 'Draft',
        lineItems: [{ description: 'Filing Fee', amount: 3500 }],
        linkedDisbursementIds: [DISB_1],
      })
      .expect(201);

    expect(mockTables.disbursements.get(DISB_1).version).toBe(2);

    // Stale client still holding expectedVersion: 1 attempts PATCH /v1/disbursements/:id -> 409 Conflict
    const stalePatchRes = await request(app)
      .patch(`/v1/disbursements/${DISB_1}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        linkedInvoiceId: null,
        expectedVersion: 1,
      })
      .expect(409);

    expect(stalePatchRes.body.code).toBe('ERR_CONCURRENCY_CONFLICT');

    // Fresh client with expectedVersion: 2 succeeds on PATCH /v1/disbursements/:id and bumps version to 3
    const freshPatchRes = await request(app)
      .patch(`/v1/disbursements/${DISB_1}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        linkedInvoiceId: null,
        expectedVersion: 2,
      })
      .expect(200);

    expect(freshPatchRes.body.data.linked_invoice_id).toBeNull();
    expect(freshPatchRes.body.data.version).toBe(3);

    const patchHistory = [...mockTables.status_history.values()].filter(
      (h) => h.table_name === 'disbursements' && h.record_id === DISB_1
    );
    expect(patchHistory.length).toBeGreaterThan(0);
    const lastHistoryEntry = patchHistory[patchHistory.length - 1];
    expect(lastHistoryEntry.details).toMatchObject({
      status: 'Released',
      by: ADMIN_USER_ID,
      action: 'link_update',
      linked_invoice_id: null,
    });
    expect(invRes.body.data.id).toBeDefined();
  });
});
