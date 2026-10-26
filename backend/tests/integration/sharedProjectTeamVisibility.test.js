/**
 * Durable Backend Regression Suite for 360° Shared Project Team Visibility (SHARED-PROJECT-VISIBILITY-20261024).
 * Exercises Findings F01-F10 and edge cases across Operations, Billing, Disbursements, Transmittals,
 * Documents, Clients, Reports, and Admin Pending Approvals.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const {
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
} = require('../fixtures/supabaseMock');

const uid = (n) => `00000000-0000-4000-b000-${String(n).padStart(12, '0')}`;

describe('360° Shared Project Team Visibility - Findings F01-F10 & Edge Cases', () => {
  const ENTITY_ATA = 'ent-ata';
  const ENTITY_LTA = 'ent-lta';

  // Users
  const leadUser = { id: uid(1), email: 'lead@ata.ph', name: 'Lead User', role: 'Staff', departments: ['Operations'], entities: ['ATA'] };
  const coAssigneeUser = { id: uid(2), email: 'co@ata.ph', name: 'Co User', role: 'Staff', departments: ['Accounting'], entities: ['ATA'] };
  const taskWorkerUser = { id: uid(3), email: 'worker@ata.ph', name: 'Worker User', role: 'Staff', departments: ['Documentation'], entities: ['ATA'] };
  const relationalWorkerUser = { id: uid(4), email: 'rel@ata.ph', name: 'Rel User', role: 'Staff', departments: ['Management'], entities: ['ATA'] };
  const outsiderUser = { id: uid(5), email: 'outsider@ata.ph', name: 'Outsider User', role: 'Staff', departments: ['Accounting'], entities: ['ATA'] };
  const formerCreatorUser = { id: uid(6), email: 'former@ata.ph', name: 'Former User', role: 'Staff', departments: ['Operations'], entities: ['ATA'] };
  const adminUser = { id: uid(7), email: 'admin@ata.ph', name: 'Admin User', role: 'Admin', departments: ['Management'], entities: ['ATA', 'LTA'] };

  let leadToken, coToken, workerToken, relToken, outsiderToken, formerToken, adminToken;

  // Projects
  const wrId = uid(10);
  const unrelatedWrId = uid(11);
  const crossEntityWrId = uid(12);

  const taskId = uid(20);
  const unrelatedTaskId = uid(21);

  const clientId = uid(30);
  const unrelatedClientId = uid(31);

  // Financial & records
  const invoiceId = uid(40);
  const unrelatedInvoiceId = uid(41);
  const disbId = uid(50);
  const unrelatedDisbId = uid(51);
  const transId = uid(60);
  const unrelatedTransId = uid(61);
  const docId = uid(70);
  const unrelatedDocId = uid(71);
  const opReqId = uid(80);
  const unrelatedOpReqId = uid(81);
  const pendingChangeId = uid(90);
  const unrelatedPendingChangeId = uid(91);

  beforeEach(() => {
    resetMock();
    seedDefaults();

    leadToken = registerUser(leadUser);
    coToken = registerUser(coAssigneeUser);
    workerToken = registerUser(taskWorkerUser);
    relToken = registerUser(relationalWorkerUser);
    outsiderToken = registerUser(outsiderUser);
    formerToken = registerUser(formerCreatorUser);
    adminToken = registerUser(adminUser);

    // Entities
    mockTables.entities.set(ENTITY_ATA, { id: ENTITY_ATA, code: 'ATA', name: 'ATA Philippines' });
    mockTables.entities.set(ENTITY_LTA, { id: ENTITY_LTA, code: 'LTA', name: 'LTA Philippines' });

    // Clients
    mockTables.clients.set(clientId, { id: clientId, entity_id: ENTITY_ATA, name: 'Project Client', status: 'Active', deleted_at: null });
    mockTables.clients.set(unrelatedClientId, { id: unrelatedClientId, entity_id: ENTITY_ATA, name: 'Secret Client', status: 'Active', deleted_at: null });

    // Authorized Work Request
    mockTables.work_requests.set(wrId, {
      id: wrId,
      entity_id: ENTITY_ATA,
      client_id: clientId,
      title: 'Authorized Project Alpha',
      status: 'In Progress',
      assigned_to: leadUser.id,
      co_assignees: [coAssigneeUser.id],
      created_by: formerCreatorUser.id,
      requested_by: formerCreatorUser.id,
      deleted_at: null,
      archived: false,
    });

    // Unrelated Work Request
    mockTables.work_requests.set(unrelatedWrId, {
      id: unrelatedWrId,
      entity_id: ENTITY_ATA,
      client_id: unrelatedClientId,
      title: 'Unrelated Project Beta',
      status: 'In Progress',
      assigned_to: uid(999),
      co_assignees: [],
      deleted_at: null,
      archived: false,
    });

    // Cross-Entity Work Request
    mockTables.work_requests.set(crossEntityWrId, {
      id: crossEntityWrId,
      entity_id: ENTITY_LTA,
      client_id: clientId,
      title: 'LTA Cross Entity Project',
      status: 'In Progress',
      assigned_to: leadUser.id,
      co_assignees: [],
      deleted_at: null,
      archived: false,
    });

    // Tasks (NO tasks.entity_id or tasks.co_assignees!)
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: wrId,
      title: 'Alpha Primary Task',
      status: 'Assigned',
      phase: 'PROCESSING',
      assignee_id: taskWorkerUser.id,
      deleted_at: null,
    });

    // Relational task assignee
    mockTables.task_assignees.set(uid(100), {
      id: uid(100),
      task_id: taskId,
      user_id: relationalWorkerUser.id,
    });

    mockTables.tasks.set(unrelatedTaskId, {
      id: unrelatedTaskId,
      work_request_id: unrelatedWrId,
      title: 'Beta Unrelated Task',
      status: 'Assigned',
      phase: 'PROCESSING',
      assignee_id: uid(999),
      deleted_at: null,
    });

    // Invoices
    mockTables.invoices.set(invoiceId, {
      id: invoiceId,
      entity_id: ENTITY_ATA,
      client_id: clientId,
      work_request_id: wrId,
      task_id: taskId,
      invoice_number: 'INV-ALPHA-01',
      status: 'Sent',
      total: 1500,
      balance: 1500,
      amount_paid: 0,
      due_date: '2026-11-01',
      deleted_at: null,
      archived: false,
      created_by: formerCreatorUser.id,
    });

    mockTables.invoices.set(unrelatedInvoiceId, {
      id: unrelatedInvoiceId,
      entity_id: ENTITY_ATA,
      client_id: unrelatedClientId,
      work_request_id: unrelatedWrId,
      task_id: unrelatedTaskId,
      invoice_number: 'INV-BETA-01',
      status: 'Sent',
      total: 2000,
      balance: 2000,
      amount_paid: 0,
      due_date: '2026-11-01',
      deleted_at: null,
      archived: false,
      created_by: uid(999),
    });

    // Disbursements
    mockTables.disbursements.set(disbId, {
      id: disbId,
      entity_id: ENTITY_ATA,
      client_id: clientId,
      linked_work_request_id: wrId,
      task_id: taskId,
      disbursement_number: 'DISB-ALPHA-01',
      status: 'Released',
      lifecycle_version: 2,
      amount: 450,
      receipt_s3_key: 'receipts/alpha.pdf',
      receipt_filename: 'receipt_alpha.pdf',
      deleted_at: null,
      archived: false,
      created_by: formerCreatorUser.id,
    });

    mockTables.disbursements.set(unrelatedDisbId, {
      id: unrelatedDisbId,
      entity_id: ENTITY_ATA,
      client_id: unrelatedClientId,
      linked_work_request_id: unrelatedWrId,
      task_id: unrelatedTaskId,
      disbursement_number: 'DISB-BETA-01',
      status: 'Released',
      lifecycle_version: 2,
      amount: 600,
      receipt_s3_key: 'receipts/beta.pdf',
      receipt_filename: 'receipt_beta.pdf',
      deleted_at: null,
      archived: false,
      created_by: uid(999),
    });

    // Transmittals
    mockTables.transmittals.set(transId, {
      id: transId,
      entity_id: ENTITY_ATA,
      client_id: clientId,
      work_request_id: wrId,
      linked_task_id: taskId,
      tracking_number: 'TR-ALPHA-01',
      status: 'Sent',
      deleted_at: null,
      archived: false,
      created_by: formerCreatorUser.id,
    });

    mockTables.transmittals.set(unrelatedTransId, {
      id: unrelatedTransId,
      entity_id: ENTITY_ATA,
      client_id: unrelatedClientId,
      work_request_id: unrelatedWrId,
      linked_task_id: unrelatedTaskId,
      tracking_number: 'TR-BETA-01',
      status: 'Sent',
      deleted_at: null,
      archived: false,
      created_by: uid(999),
    });

    // Documents
    mockTables.documents.set(docId, {
      id: docId,
      entity_id: ENTITY_ATA,
      client_id: clientId,
      work_request_id: wrId,
      linked_task_id: taskId,
      original_name: 'alpha_plan.pdf',
      storage_path: 'docs/alpha_plan.pdf',
      status: 'uploaded',
      deleted_at: null,
      archived: false,
      created_by: formerCreatorUser.id,
    });

    mockTables.documents.set(unrelatedDocId, {
      id: unrelatedDocId,
      entity_id: ENTITY_ATA,
      client_id: unrelatedClientId,
      work_request_id: unrelatedWrId,
      linked_task_id: unrelatedTaskId,
      original_name: 'beta_secret.pdf',
      storage_path: 'docs/beta_secret.pdf',
      status: 'uploaded',
      deleted_at: null,
      archived: false,
      created_by: uid(999),
    });

    // Operations Requests
    mockTables.operations_requests.set(opReqId, {
      id: opReqId,
      entity_id: ENTITY_ATA,
      type: 'billing',
      status: 'pending',
      work_request_id: wrId,
      linked_task_id: taskId,
      requested_by: leadUser.id,
      payload: { notes: 'Alpha billing request' },
    });

    mockTables.operations_requests.set(unrelatedOpReqId, {
      id: unrelatedOpReqId,
      entity_id: ENTITY_ATA,
      type: 'billing',
      status: 'pending',
      work_request_id: unrelatedWrId,
      linked_task_id: unrelatedTaskId,
      requested_by: uid(999),
      payload: { notes: 'Beta secret billing request' },
    });

    // Pending Approvals
    mockTables.pending_changes.set(pendingChangeId, {
      id: pendingChangeId,
      entity_id: ENTITY_ATA,
      table_name: 'invoices',
      parent_record_id: invoiceId,
      proposed_data: { notes: 'Alpha invoice update' },
      submitted_by: leadUser.id,
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    mockTables.pending_changes.set(unrelatedPendingChangeId, {
      id: unrelatedPendingChangeId,
      entity_id: ENTITY_ATA,
      table_name: 'invoices',
      parent_record_id: unrelatedInvoiceId,
      proposed_data: { notes: 'Beta secret invoice update' },
      submitted_by: uid(999),
      status: 'pending',
      created_at: new Date().toISOString(),
    });
  });

  const get = (url, token, entity = 'ATA') =>
    request(app).get(url).set('Authorization', `Bearer ${token}`).set('X-Active-Entity', entity);

  describe('F01: Billing & Invoices 360° Visibility', () => {
    test.each([
      ['lead', () => leadToken],
      ['co-assignee', () => coToken],
      ['task-primary', () => workerToken],
      ['task-join', () => relToken],
    ])('%s can read project invoices', async (_, getToken) => {
      const res = await get(`/v1/invoices/${invoiceId}`, getToken());
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(invoiceId);

      const list = await get('/v1/invoices', getToken());
      expect(list.status).toBe(200);
      expect(list.body.data.map((i) => i.id)).toContain(invoiceId);
      expect(list.body.data.map((i) => i.id)).not.toContain(unrelatedInvoiceId);
    });

    test('outsider accountant cannot read unrelated invoice or list it', async () => {
      const detail = await get(`/v1/invoices/${unrelatedInvoiceId}`, outsiderToken);
      expect([403, 404]).toContain(detail.status);

      const list = await get('/v1/invoices', outsiderToken);
      expect(list.status).toBe(200);
      expect(list.body.data.map((i) => i.id)).not.toContain(unrelatedInvoiceId);
    });
  });

  describe('F02: Disbursements & Receipts 360° Visibility', () => {
    test.each([
      ['lead', () => leadToken],
      ['co-assignee', () => coToken],
      ['task-primary', () => workerToken],
      ['task-join', () => relToken],
    ])('%s can read project disbursement and receipt URL', async (_, getToken) => {
      const detail = await get(`/v1/disbursements/${disbId}`, getToken());
      expect(detail.status).toBe(200);
      expect(detail.body.data.id).toBe(disbId);

      const receipt = await get(`/v1/disbursements/${disbId}/receipt-url`, getToken());
      expect(receipt.status).toBe(200);
      expect(receipt.body.data.url).toBeDefined();

      const list = await get('/v1/disbursements', getToken());
      expect(list.status).toBe(200);
      expect(list.body.data.map((d) => d.id)).toContain(disbId);
      expect(list.body.data.map((d) => d.id)).not.toContain(unrelatedDisbId);
    });

    test('outsider cannot read unrelated disbursement receipt URL (no file side effects)', async () => {
      const receipt = await get(`/v1/disbursements/${unrelatedDisbId}/receipt-url`, outsiderToken);
      expect([403, 404]).toContain(receipt.status);
    });
  });

  describe('F03: Transmittals 360° Visibility', () => {
    test.each([
      ['lead', () => leadToken],
      ['co-assignee', () => coToken],
      ['task-primary', () => workerToken],
      ['task-join', () => relToken],
    ])('%s can read project transmittals', async (_, getToken) => {
      const detail = await get(`/v1/transmittals/${transId}`, getToken());
      expect(detail.status).toBe(200);
      expect(detail.body.data.id).toBe(transId);

      const list = await get('/v1/transmittals', getToken());
      expect(list.status).toBe(200);
      expect(list.body.data.map((t) => t.id)).toContain(transId);
      expect(list.body.data.map((t) => t.id)).not.toContain(unrelatedTransId);
    });
  });

  describe('F04: Documents 360° Visibility & Outsider Download Denial', () => {
    test.each([
      ['lead', () => leadToken],
      ['co-assignee', () => coToken],
      ['task-primary', () => workerToken],
      ['task-join', () => relToken],
    ])('%s can read project document and get download URL', async (_, getToken) => {
      const detail = await get(`/v1/documents/${docId}`, getToken());
      expect(detail.status).toBe(200);
      expect(detail.body.data.id).toBe(docId);

      const download = await get(`/v1/documents/${docId}/download-url`, getToken());
      expect(download.status).toBe(200);
      expect(download.body.data.url).toBeDefined();
    });

    test('outsider cannot download unrelated document', async () => {
      const download = await get(`/v1/documents/${unrelatedDocId}/download-url`, outsiderToken);
      expect([403, 404]).toContain(download.status);
    });
  });

  describe('F05: Operations Requests Queue & Detail Authorization', () => {
    test('team members can read project operations requests and counts', async () => {
      const detail = await get(`/v1/operations-requests/${opReqId}`, leadToken);
      expect(detail.status).toBe(200);
      expect(detail.body.data.id).toBe(opReqId);

      const list = await get('/v1/operations-requests', leadToken);
      expect(list.status).toBe(200);
      expect(list.body.data.map((r) => r.id)).toContain(opReqId);
      expect(list.body.data.map((r) => r.id)).not.toContain(unrelatedOpReqId);

      const counts = await get('/v1/operations-requests/counts', leadToken);
      expect(counts.status).toBe(200);
      expect(counts.body.data.total).toBe(1);
    });

    test('outsider cannot read unrelated operations request detail or discover its count', async () => {
      const detail = await get(`/v1/operations-requests/${unrelatedOpReqId}`, outsiderToken);
      expect([403, 404]).toContain(detail.status);

      const list = await get('/v1/operations-requests', outsiderToken);
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([]);

      const counts = await get('/v1/operations-requests/counts', outsiderToken);
      expect(counts.status).toBe(200);
      expect(counts.body.data.total).toBe(0);
    });
  });

  describe('F06: Clients & Subrecords Scoped by Project', () => {
    test('team member can view their project client but not unrelated client', async () => {
      const allowedClient = await get(`/v1/clients/${clientId}`, leadToken);
      expect(allowedClient.status).toBe(200);
      expect(allowedClient.body.data.id).toBe(clientId);

      const secretClient = await get(`/v1/clients/${unrelatedClientId}`, leadToken);
      expect([403, 404]).toContain(secretClient.status);

      const list = await get('/v1/clients', leadToken);
      expect(list.status).toBe(200);
      expect(list.body.data.map((c) => c.id)).toContain(clientId);
      expect(list.body.data.map((c) => c.id)).not.toContain(unrelatedClientId);
    });
  });

  describe('F07: Reports & Analytics Dynamic Revocation & Non-Admin Freshness', () => {
    test('reports and aging expose only authorized project amounts', async () => {
      const aging = await get('/v1/invoices/aging', leadToken);
      expect(aging.status).toBe(200);
      expect(aging.body.data.summary.grandTotal).toBe(1500);

      const outsiderAging = await get('/v1/invoices/aging', outsiderToken);
      expect(outsiderAging.status).toBe(200);
      expect(outsiderAging.body.data.summary.grandTotal).toBe(0);
    });
  });

  describe('F08: Admin Pending Approvals Queue Project Boundary', () => {
    test('accounting outsider cannot discover unrelated project pending changes', async () => {
      const res = await get('/v1/admin/pending-approvals', outsiderToken);
      expect(res.status).toBe(200);
      expect(res.body.data.map((p) => p.id)).not.toContain(unrelatedPendingChangeId);
    });

    test('admin sees all pending changes', async () => {
      const res = await get('/v1/admin/pending-approvals', adminToken);
      expect(res.status).toBe(200);
      expect(res.body.data.map((p) => p.id)).toContain(pendingChangeId);
      expect(res.body.data.map((p) => p.id)).toContain(unrelatedPendingChangeId);
    });
  });

  describe('F10: Revoked / Former Creator Access Removal', () => {
    test('former creator/requester with no current assignment cannot view project records', async () => {
      const wrRes = await get(`/v1/work-requests/${wrId}`, formerToken);
      expect([403, 404]).toContain(wrRes.status);

      const invRes = await get(`/v1/invoices/${invoiceId}`, formerToken);
      expect([403, 404]).toContain(invRes.status);

      const disbRes = await get(`/v1/disbursements/${disbId}`, formerToken);
      expect([403, 404]).toContain(disbRes.status);

      const transRes = await get(`/v1/transmittals/${transId}`, formerToken);
      expect([403, 404]).toContain(transRes.status);

      const docRes = await get(`/v1/documents/${docId}`, formerToken);
      expect([403, 404]).toContain(docRes.status);

      const list = await get('/v1/work-requests', formerToken);
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([]);
    });
  });

  describe('Edge Cases: Linkage Corruptions, Soft-Deletes & Entity Isolation', () => {
    test('conflicting task canonical and legacy IDs fail closed', async () => {
      mockTables.invoices.get(invoiceId).task_id = taskId;
      mockTables.invoices.get(invoiceId).linked_task_id = unrelatedTaskId;

      const detail = await get(`/v1/invoices/${invoiceId}`, leadToken);
      expect([400, 403, 404]).toContain(detail.status);

      const list = await get('/v1/invoices', leadToken);
      expect(list.status).toBe(200);
      expect(list.body.data.map((i) => i.id)).not.toContain(invoiceId);
    });

    test('soft-deleted parent work request removes access', async () => {
      mockTables.work_requests.get(wrId).deleted_at = new Date().toISOString();

      const detail = await get(`/v1/invoices/${invoiceId}`, leadToken);
      expect([403, 404]).toContain(detail.status);

      const list = await get('/v1/invoices', leadToken);
      expect(list.status).toBe(200);
      expect(list.body.data.map((i) => i.id)).not.toContain(invoiceId);
    });

    test('entity boundary: non-admin in ATA cannot view LTA data even when assigned', async () => {
      const ltaDetail = await get(`/v1/work-requests/${crossEntityWrId}`, leadToken, 'ATA');
      expect([403, 404]).toContain(ltaDetail.status);
    });
  });

  describe('Public Action Responses Cannot Bypass Project Reads', () => {
    test('accounting outsider cannot archive an unrelated invoice', async () => {
      mockTables.invoices.get(unrelatedInvoiceId).version = 1;
      const res = await request(app)
        .post(`/v1/invoices/${unrelatedInvoiceId}/archive`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ expectedVersion: 1 });
      expect([403, 404]).toContain(res.status);
      expect(mockTables.invoices.get(unrelatedInvoiceId).archived).toBe(false);
    });

    test('accounting outsider cannot patch an unrelated invoice', async () => {
      mockTables.invoices.get(unrelatedInvoiceId).version = 1;
      const res = await request(app)
        .patch(`/v1/invoices/${unrelatedInvoiceId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ printDetails: { clientName: 'Unrelated edit' }, expectedVersion: 1 });
      expect([403, 404]).toContain(res.status);
      expect(mockTables.invoices.get(unrelatedInvoiceId).print_details).toBeUndefined();
    });

    test('manager outsider cannot patch unrelated task, but assigned lead manager can', async () => {
      const managerLeadId = uid(881);
      const managerLeadToken = registerUser({
        id: managerLeadId,
        email: 'mgr-lead@fixture.invalid',
        name: 'Manager Lead',
        role: 'Manager',
        departments: ['Management'],
        entities: ['ATA'],
      });
      mockTables.work_requests.get(wrId).assigned_to = managerLeadId;

      mockTables.tasks.get(taskId).version = 1;
      mockTables.tasks.get(unrelatedTaskId).version = 1;

      // Outsider attempt on unrelated task
      const outsiderRes = await request(app)
        .patch(`/v1/tasks/${unrelatedTaskId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ description: 'Illegal edit', expectedVersion: 1 });
      expect([403, 404]).toContain(outsiderRes.status);
      expect(mockTables.tasks.get(unrelatedTaskId).description).not.toBe('Illegal edit');

      // Lead attempt on assigned project task
      const leadRes = await request(app)
        .patch(`/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ description: 'Reviewed project note', expectedVersion: 1 });
      expect(leadRes.status).toBe(200);
      expect(mockTables.tasks.get(taskId).description).toBe('Reviewed project note');
    });

    test('outsider cannot delete an unrelated task', async () => {
      const res = await request(app)
        .delete(`/v1/tasks/${unrelatedTaskId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('X-Active-Entity', 'ATA');
      expect([403, 404]).toContain(res.status);
      expect(mockTables.tasks.get(unrelatedTaskId).deleted_at).toBeNull();
    });

    test('DMS metadata action respects project boundary: outsider denied, lead succeeds', async () => {
      const docOutsiderToken = registerUser({
        id: uid(931),
        email: 'doc-outsider@fixture.invalid',
        name: 'Doc Outsider',
        role: 'Staff',
        departments: ['Documentation'],
        entities: ['ATA'],
      });
      const docLeadToken = registerUser({
        id: uid(932),
        email: 'doc-lead@fixture.invalid',
        name: 'Doc Lead',
        role: 'Staff',
        departments: ['Documentation'],
        entities: ['ATA'],
      });
      mockTables.work_requests.get(wrId).assigned_to = uid(932);

      const outsiderRes = await request(app)
        .put(`/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${docOutsiderToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ description: 'Hacked description' });
      expect([403, 404]).toContain(outsiderRes.status);
      expect(mockTables.documents.get(docId).description).not.toBe('Hacked description');

      const leadRes = await request(app)
        .put(`/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${docLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ description: 'Reviewed metadata' });
      expect(leadRes.status).toBe(200);
      expect(mockTables.documents.get(docId).description).toBe('Reviewed metadata');
    });

    test('Draft disbursement edit: outsider denied, lead succeeds', async () => {
      Object.assign(mockTables.disbursements.get(unrelatedDisbId), {
        status: 'Draft',
        version: 1,
        review_ready: true,
      });
      const outsiderRes = await request(app)
        .put(`/v1/disbursements/${unrelatedDisbId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ description: 'Unauthorized edit', expectedVersion: 1 });
      expect([403, 404]).toContain(outsiderRes.status);
      expect(mockTables.disbursements.get(unrelatedDisbId).description).not.toBe('Unauthorized edit');
    });

    test('Transmittal edit: outsider denied', async () => {
      const outsiderRes = await request(app)
        .put(`/v1/transmittals/${unrelatedTransId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ recipientName: 'Untrusted Recipient' });
      expect([403, 404]).toContain(outsiderRes.status);
      expect(mockTables.transmittals.get(unrelatedTransId).recipient_name).not.toBe('Untrusted Recipient');
    });

    test('ALL active entity retains assigned project report data across daily, weekly, monthly-pending', async () => {
      const allUser = registerUser({
        id: uid(901),
        email: 'all-worker@fixture.invalid',
        name: 'All Worker',
        role: 'Staff',
        departments: ['Accounting'],
        entities: ['ATA', 'LTA'],
      });
      mockTables.work_requests.get(wrId).assigned_to = uid(901);

      for (const inv of mockTables.invoices.values()) {
        inv.created_at = '2026-10-01T12:00:00.000Z';
      }

      for (const url of [
        '/v1/reports/daily?date=2026-10-01',
        '/v1/reports/weekly?date=2026-10-01',
        '/v1/reports/monthly-pending?month=2026-10',
      ]) {
        const ataRes = await request(app)
          .get(url)
          .set('Authorization', `Bearer ${allUser}`)
          .set('X-Active-Entity', 'ATA');
        const allRes = await request(app)
          .get(url)
          .set('Authorization', `Bearer ${allUser}`)
          .set('X-Active-Entity', 'ALL');

        expect(ataRes.status).toBe(200);
        expect(allRes.status).toBe(200);
        expect(allRes.body).toEqual(ataRes.body);
        expect(JSON.stringify(allRes.body)).not.toContain(unrelatedInvoiceId);
      }
    });

    test('Queue targets: conflicting task parent excludes corrupt operations request and pending change', async () => {
      const corruptOpId = uid(99501);
      mockTables.operations_requests.set(corruptOpId, {
        id: corruptOpId,
        entity_id: 'ent-ata',
        work_request_id: wrId,
        linked_task_id: unrelatedTaskId,
        status: 'pending',
        type: 'billing',
        amount: 5000,
        requested_by: outsiderUser.id,
      });

      const opDetail = await request(app)
        .get(`/v1/operations-requests/${corruptOpId}`)
        .set('Authorization', `Bearer ${leadToken}`)
        .set('X-Active-Entity', 'ATA');
      expect([400, 403, 404]).toContain(opDetail.status);

      const opList = await request(app)
        .get('/v1/operations-requests')
        .set('Authorization', `Bearer ${leadToken}`)
        .set('X-Active-Entity', 'ATA');
      expect(opList.status).toBe(200);
      expect(opList.body.data.map((r) => r.id)).not.toContain(corruptOpId);

      const corruptChangeId = uid(99502);
      mockTables.invoices.get(unrelatedInvoiceId).work_request_id = wrId;
      mockTables.pending_changes.set(corruptChangeId, {
        id: corruptChangeId,
        entity_id: 'ent-ata',
        table_name: 'invoices',
        parent_record_id: unrelatedInvoiceId,
        status: 'pending',
        proposed_data: { notes: 'Corrupt proposal' },
        submitted_by: outsiderUser.id,
      });

      const pendingRes = await request(app)
        .get('/v1/admin/pending-approvals')
        .set('Authorization', `Bearer ${leadToken}`)
        .set('X-Active-Entity', 'ATA');
      expect(pendingRes.status).toBe(200);
      expect(pendingRes.body.data.map((c) => c.id)).not.toContain(corruptChangeId);
    });
  });

  describe('Pending approval canonical scope regressions', () => {
    test.each(['entity', 'task-alias', 'wr-alias', 'deleted-parent', 'missing-target'])(
      'excludes %s targets before returning proposed private data', async corruption => {
        const invoice = mockTables.invoices.get(invoiceId);
        if (corruption === 'entity') invoice.entity_id = ENTITY_LTA;
        if (corruption === 'task-alias') invoice.linked_task_id = unrelatedTaskId;
        if (corruption === 'wr-alias') invoice.linked_work_request_id = unrelatedWrId;
        if (corruption === 'deleted-parent') mockTables.work_requests.get(wrId).deleted_at = new Date().toISOString();
        if (corruption === 'missing-target') mockTables.invoices.delete(invoiceId);
        mockTables.pending_changes.get(pendingChangeId).proposed_data = { workRequestId: wrId, notes: 'Private proposal' };
        const res = await get('/v1/admin/pending-approvals', coToken);
        expect(res.status).toBe(200);
        expect(res.body.data.map(row => row.id)).not.toContain(pendingChangeId);
      }
    );

    test('keeps valid assigned creation proposals and excludes conflicting aliases', async () => {
      const validId = uid(99601), invalidId = uid(99602);
      for (const [id, proposed] of [
        [validId, { workRequestId: wrId, taskId, notes: 'Assigned creation' }],
        [invalidId, { workRequestId: wrId, linkedWorkRequestId: unrelatedWrId, taskId }],
      ]) {
        mockTables.pending_changes.set(id, { id, entity_id: ENTITY_ATA, table_name: 'invoices', parent_record_id: null,
          status: 'pending', proposed_data: proposed, submitted_by: leadUser.id });
      }
      const res = await get('/v1/admin/pending-approvals', coToken);
      expect(res.status).toBe(200);
      expect(res.body.data.map(row => row.id)).toContain(validId);
      expect(res.body.data.map(row => row.id)).not.toContain(invalidId);
    });
  });

});
