/**
 * Integration Test Suite: Server-Side Entity 'ALL' Fix
 *
 * Verifies:
 * 1. Omitted X-Active-Entity defaults to 'ALL' for authorized managerial users with access to both entities.
 * 2. Omitted header for staff with only 'ATA' defaults safely to 'ATA'.
 * 3. Retainer templates list returns cross-entity data when activeEntity is 'ALL' or header is omitted.
 * 4. Invoices list returns cross-entity data when activeEntity is 'ALL' or header is omitted.
 * 5. Disbursements list returns cross-entity data when activeEntity is 'ALL' or header is omitted.
 * 6. Documents list and counts return cross-entity data when activeEntity is 'ALL' or header is omitted.
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

describe('Server-Side Entity ALL Scoping and Listing Fix', () => {
  let adminToken;
  let staffAtaToken;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    adminToken = registerUser({
      id: '11111111-aaaa-bbbb-cccc-000000000001',
      email: 'UAT-admin-all@ata-lta.ph',
      name: 'UAT Admin All',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    staffAtaToken = registerUser({
      id: '33333333-aaaa-bbbb-cccc-000000000003',
      email: 'UAT-staff-ata@ata-lta.ph',
      name: 'UAT Staff ATA',
      role: 'Accounting',
      departments: ['Accounting'],
      entities: ['ATA'],
    });

    // Seed Retainer Templates in ATA and LTA
    mockTables.retainer_templates.set('tpl-ata-1', {
      id: 'tpl-ata-1',
      entity_id: 'ent-ata',
      name: 'ATA Retainer Template',
      deleted_at: null,
    });
    mockTables.retainer_templates.set('tpl-lta-1', {
      id: 'tpl-lta-1',
      entity_id: 'ent-lta',
      name: 'LTA Retainer Template',
      deleted_at: null,
    });

    // Invoice reads also require a valid project relationship. Give this user a
    // project in each entity so the omitted-header test isolates entity access,
    // rather than accidentally exercising the orphan-record visibility guard.
    const assignedStaffId = '33333333-aaaa-bbbb-cccc-000000000003';
    const ataWorkRequestId = '44444444-4444-4444-8444-444444444444';
    const ltaWorkRequestId = '55555555-5555-4555-8555-555555555555';
    mockTables.work_requests.set(ataWorkRequestId, {
      id: ataWorkRequestId,
      entity_id: 'ent-ata',
      assigned_to: assignedStaffId,
      deleted_at: null,
    });
    mockTables.work_requests.set(ltaWorkRequestId, {
      id: ltaWorkRequestId,
      entity_id: 'ent-lta',
      assigned_to: assignedStaffId,
      deleted_at: null,
    });

    // Seed Invoices in ATA and LTA
    mockTables.invoices.set('inv-ata-1', {
      id: 'inv-ata-1',
      entity_id: 'ent-ata',
      invoice_number: 'INV-ATA-001',
      work_request_id: ataWorkRequestId,
      status: 'Sent',
      deleted_at: null,
      archived: false,
    });
    mockTables.invoices.set('inv-lta-1', {
      id: 'inv-lta-1',
      entity_id: 'ent-lta',
      invoice_number: 'INV-LTA-001',
      work_request_id: ltaWorkRequestId,
      status: 'Sent',
      deleted_at: null,
      archived: false,
    });

    // Seed Disbursements in ATA and LTA
    mockTables.disbursements.set('disb-ata-1', {
      id: 'disb-ata-1',
      entity_id: 'ent-ata',
      disbursement_number: 'DISB-ATA-001',
      status: 'Approved',
      deleted_at: null,
      archived: false,
    });
    mockTables.disbursements.set('disb-lta-1', {
      id: 'disb-lta-1',
      entity_id: 'ent-lta',
      disbursement_number: 'DISB-LTA-001',
      status: 'Approved',
      deleted_at: null,
      archived: false,
    });

    // Seed Documents in ATA and LTA
    mockTables.documents.set('doc-ata-1', {
      id: 'doc-ata-1',
      entity_id: 'ent-ata',
      title: 'ATA Doc 1',
      archived: false,
      deleted_at: null,
    });
    mockTables.documents.set('doc-lta-1', {
      id: 'doc-lta-1',
      entity_id: 'ent-lta',
      title: 'LTA Doc 1',
      archived: false,
      deleted_at: null,
    });
  });

  describe('Retainer Templates', () => {
    test('Admin with header omitted receives templates from both entities', async () => {
      const res = await request(app)
        .get('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    test('Admin with explicit X-Active-Entity: ALL receives templates from both entities', async () => {
      const res = await request(app)
        .get('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    test('Admin with X-Active-Entity: ATA receives ATA template only', async () => {
      const res = await request(app)
        .get('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('tpl-ata-1');
    });
  });

  describe('Invoices', () => {
    test('Admin with header omitted receives invoices from both entities', async () => {
      const res = await request(app)
        .get('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    test('Admin with X-Active-Entity: ALL receives invoices from both entities', async () => {
      const res = await request(app)
        .get('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    test('Staff with ATA-only access omitting header defaults safely to ATA invoices only', async () => {
      const res = await request(app)
        .get('/v1/invoices')
        .set('Authorization', `Bearer ${staffAtaToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('inv-ata-1');
    });
  });

  describe('Disbursements', () => {
    test('Admin with header omitted receives disbursements from both entities', async () => {
      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    test('Admin with X-Active-Entity: ALL receives disbursements from both entities', async () => {
      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('Documents', () => {
    test('Admin with header omitted receives documents from both entities', async () => {
      const res = await request(app)
        .get('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    test('Admin with X-Active-Entity: ALL receives documents counts from both entities', async () => {
      const res = await request(app)
        .get('/v1/documents/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL');

      expect(res.status).toBe(200);
      expect(res.body.data.active).toBe(2);
    });
  });
});
