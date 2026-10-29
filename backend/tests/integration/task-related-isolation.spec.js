/**
 * Integration & Service Regression Suite: Cross-Task Document Isolation
 * Spec: docs/delegation/CROSS_TASK_DOCUMENT_ISOLATION_AGY_20261024.md
 * Audit: docs/audits/cross-task-document-leakage-2026-10-24/Audit Report.md
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
const operationsService = require('../../src/modules/operations/service');

describe('Cross-Task Document Isolation (getTaskRelated)', () => {
  const ENTITY_ATA = 'ent-ata';
  const ENTITY_LTA = 'ent-lta';

  const WR_A_ID = '00000000-0000-4000-a000-000000000001';
  const WR_B_ID = '00000000-0000-4000-a000-000000000002';

  const TASK_1_ID = '11111111-1111-4000-a000-000000000001';
  const TASK_3_ID = '33333333-3333-4000-a000-000000000003';
  const TASK_EMPTY_ID = '44444444-4444-4000-a000-000000000004';
  const TASK_OTHER_WR_ID = '55555555-5555-4000-a000-000000000005';

  let adminUser;
  let adminToken;
  let accountingUser;
  let creatorUser;
  let otherCreatorUser;
  let unrelatedStaffUser;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    adminToken = registerUser({
      id: 'aaaaaaaa-aaaa-4000-a000-000000000001',
      email: 'admin-iso@ata-lta.ph',
      name: 'Admin Isolation',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });
    adminUser = {
      id: 'aaaaaaaa-aaaa-4000-a000-000000000001',
      email: 'admin-iso@ata-lta.ph',
      name: 'Admin Isolation',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    };

    accountingUser = {
      id: 'bbbbbbbb-bbbb-4000-a000-000000000002',
      email: 'accounting-iso@ata-lta.ph',
      name: 'Accounting Iso',
      role: 'Staff',
      entities: ['ATA'],
      departments: ['Accounting'],
    };

    creatorUser = {
      id: 'cccccccc-cccc-4000-a000-000000000003',
      email: 'creator-iso@ata-lta.ph',
      name: 'Creator Iso',
      role: 'Staff',
      entities: ['ATA'],
      departments: ['Operations'],
    };

    otherCreatorUser = {
      id: 'dddddddd-dddd-4000-a000-000000000004',
      email: 'other-creator-iso@ata-lta.ph',
      name: 'Other Creator Iso',
      role: 'Staff',
      entities: ['ATA'],
      departments: ['Operations'],
    };

    unrelatedStaffUser = {
      id: 'eeeeeeee-eeee-4000-a000-000000000005',
      email: 'unrelated-staff-iso@ata-lta.ph',
      name: 'Unrelated Staff',
      role: 'Staff',
      entities: ['ATA'],
      departments: ['Operations'],
    };

    // Work Request A (ATA)
    mockTables.work_requests.set(WR_A_ID, {
      id: WR_A_ID,
      entity_id: ENTITY_ATA,
      title: 'Work Request Alpha',
      status: 'In Progress',
      deleted_at: null,
    });

    // Work Request B (ATA - Unrelated)
    mockTables.work_requests.set(WR_B_ID, {
      id: WR_B_ID,
      entity_id: ENTITY_ATA,
      title: 'Work Request Beta',
      status: 'In Progress',
      deleted_at: null,
    });

    // Sibling Tasks under WR A
    mockTables.tasks.set(TASK_1_ID, {
      id: TASK_1_ID,
      work_request_id: WR_A_ID,
      title: 'Task 1 in WR A',
      status: 'In Progress',
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_3_ID, {
      id: TASK_3_ID,
      work_request_id: WR_A_ID,
      title: 'Task 3 in WR A',
      status: 'In Progress',
      deleted_at: null,
    });

    // Empty Sibling Task under WR A
    mockTables.tasks.set(TASK_EMPTY_ID, {
      id: TASK_EMPTY_ID,
      work_request_id: WR_A_ID,
      title: 'Task Empty in WR A',
      status: 'Pending',
      deleted_at: null,
    });

    // Task under unrelated WR B
    mockTables.tasks.set(TASK_OTHER_WR_ID, {
      id: TASK_OTHER_WR_ID,
      work_request_id: WR_B_ID,
      title: 'Task in WR B',
      status: 'In Progress',
      deleted_at: null,
    });
  });

  describe('Core Sibling Isolation & Audit Reproduction', () => {
    beforeEach(() => {
      // Seed Task 1 records
      mockTables.invoices.set('inv-task-1', {
        id: 'inv-task-1',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: TASK_1_ID,
        invoice_number: 'INV-T1',
        deleted_at: null,
      });
      mockTables.disbursements.set('disb-task-1', {
        id: 'disb-task-1',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: TASK_1_ID,
        disbursement_number: 'DISB-T1',
        created_by: creatorUser.id,
        deleted_at: null,
      });
      mockTables.transmittals.set('trans-task-1', {
        id: 'trans-task-1',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        linked_task_id: TASK_1_ID,
        tracking_number: 'TR-T1',
        deleted_at: null,
      });

      // Seed Task 3 records
      mockTables.invoices.set('inv-task-3', {
        id: 'inv-task-3',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        task_id: TASK_3_ID,
        linked_task_id: TASK_3_ID,
        invoice_number: 'INV-T3',
        deleted_at: null,
      });
      mockTables.disbursements.set('disb-task-3', {
        id: 'disb-task-3',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_A_ID,
        task_id: TASK_3_ID,
        linked_task_id: TASK_3_ID,
        disbursement_number: 'DISB-T3',
        created_by: creatorUser.id,
        deleted_at: null,
      });
      mockTables.transmittals.set('trans-task-3', {
        id: 'trans-task-3',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        linked_task_id: TASK_3_ID,
        tracking_number: 'TR-T3',
        deleted_at: null,
      });

      // Seed Parent-only records (belonging to WR A, but no task)
      mockTables.invoices.set('inv-parent-only', {
        id: 'inv-parent-only',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        task_id: null,
        linked_task_id: null,
        invoice_number: 'INV-PARENT',
        deleted_at: null,
      });
      mockTables.disbursements.set('disb-parent-only', {
        id: 'disb-parent-only',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_A_ID,
        task_id: null,
        linked_task_id: null,
        disbursement_number: 'DISB-PARENT',
        created_by: creatorUser.id,
        deleted_at: null,
      });
      mockTables.transmittals.set('trans-parent-only', {
        id: 'trans-parent-only',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        linked_task_id: null,
        tracking_number: 'TR-PARENT',
        deleted_at: null,
      });
    });

    it('returns only Task 1 records for Task 1, excluding sibling Task 3 and parent-only rows', async () => {
      const res = await operationsService.getTaskRelated({
        id: TASK_1_ID,
        entityId: ENTITY_ATA,
        caller: adminUser,
      });

      expect(res.invoices.map((i) => i.id)).toEqual(['inv-task-1']);
      expect(res.disbursements.map((d) => d.id)).toEqual(['disb-task-1']);
      expect(res.transmittals.map((t) => t.id)).toEqual(['trans-task-1']);
    });

    it('returns only Task 3 records for Task 3, excluding sibling Task 1 and parent-only rows', async () => {
      const res = await operationsService.getTaskRelated({
        id: TASK_3_ID,
        entityId: ENTITY_ATA,
        caller: adminUser,
      });

      expect(res.invoices.map((i) => i.id)).toEqual(['inv-task-3']);
      expect(res.disbursements.map((d) => d.id)).toEqual(['disb-task-3']);
      expect(res.transmittals.map((t) => t.id)).toEqual(['trans-task-3']);
    });

    it('returns empty collections for empty sibling task, without bleeding sibling records', async () => {
      const res = await operationsService.getTaskRelated({
        id: TASK_EMPTY_ID,
        entityId: ENTITY_ATA,
        caller: adminUser,
      });

      expect(res.invoices).toEqual([]);
      expect(res.disbursements).toEqual([]);
      expect(res.transmittals).toEqual([]);
    });

    it('retains parent-only and sibling records when aggregating at work-request level', async () => {
      const wrRelated = await operationsService.getWorkRequestRelated({
        id: WR_A_ID,
        caller: adminUser,
      });

      const invIds = wrRelated.invoices.map((i) => i.id);
      expect(invIds).toContain('inv-task-1');
      expect(invIds).toContain('inv-task-3');
      expect(invIds).toContain('inv-parent-only');

      const disbIds = wrRelated.disbursements.map((d) => d.id);
      expect(disbIds).toContain('disb-task-1');
      expect(disbIds).toContain('disb-task-3');
      expect(disbIds).toContain('disb-parent-only');

      const transIds = wrRelated.transmittals.map((t) => t.id);
      expect(transIds).toContain('trans-task-1');
      expect(transIds).toContain('trans-task-3');
      expect(transIds).toContain('trans-parent-only');
    });

    it('enforces isolation over HTTP GET /v1/operations/tasks/:id/related', async () => {
      const response = await request(app)
        .get(`/v1/operations/tasks/${TASK_3_ID}/related`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.invoices.map((i) => i.id)).toEqual(['inv-task-3']);
      expect(response.body.data.disbursements.map((d) => d.id)).toEqual(['disb-task-3']);
      expect(response.body.data.transmittals.map((t) => t.id)).toEqual(['trans-task-3']);
    });
  });

  describe('Alias Semantics: Canonical, Legacy, and Conflicting Aliases', () => {
    it('supports canonical-only links (task_id set, linked_task_id null)', async () => {
      mockTables.invoices.set('inv-canonical', {
        id: 'inv-canonical',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: null,
        deleted_at: null,
      });
      mockTables.disbursements.set('disb-canonical', {
        id: 'disb-canonical',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: null,
        created_by: creatorUser.id,
        deleted_at: null,
      });

      const resT1 = await operationsService.getTaskRelated(TASK_1_ID, adminUser);
      expect(resT1.invoices.map((i) => i.id)).toContain('inv-canonical');
      expect(resT1.disbursements.map((d) => d.id)).toContain('disb-canonical');

      const resT3 = await operationsService.getTaskRelated(TASK_3_ID, adminUser);
      expect(resT3.invoices.map((i) => i.id)).not.toContain('inv-canonical');
      expect(resT3.disbursements.map((d) => d.id)).not.toContain('disb-canonical');
    });

    it('supports legacy-only links (task_id null, linked_task_id set)', async () => {
      mockTables.invoices.set('inv-legacy', {
        id: 'inv-legacy',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        task_id: null,
        linked_task_id: TASK_1_ID,
        deleted_at: null,
      });
      mockTables.disbursements.set('disb-legacy', {
        id: 'disb-legacy',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_A_ID,
        task_id: null,
        linked_task_id: TASK_1_ID,
        created_by: creatorUser.id,
        deleted_at: null,
      });

      const resT1 = await operationsService.getTaskRelated(TASK_1_ID, adminUser);
      expect(resT1.invoices.map((i) => i.id)).toContain('inv-legacy');
      expect(resT1.disbursements.map((d) => d.id)).toContain('disb-legacy');

      const resT3 = await operationsService.getTaskRelated(TASK_3_ID, adminUser);
      expect(resT3.invoices.map((i) => i.id)).not.toContain('inv-legacy');
      expect(resT3.disbursements.map((d) => d.id)).not.toContain('disb-legacy');
    });

    it('conflicting task canonical and legacy aliases fail closed and are not exposed', async () => {
      // Record has canonical task_id = TASK_1_ID, but conflicting linked_task_id = TASK_3_ID
      mockTables.invoices.set('inv-conflict-1', {
        id: 'inv-conflict-1',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: TASK_3_ID,
        deleted_at: null,
      });
      mockTables.disbursements.set('disb-conflict-1', {
        id: 'disb-conflict-1',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: TASK_3_ID,
        created_by: creatorUser.id,
        deleted_at: null,
      });

      // Record has canonical task_id = TASK_3_ID, but conflicting linked_task_id = TASK_1_ID
      mockTables.invoices.set('inv-conflict-3', {
        id: 'inv-conflict-3',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        task_id: TASK_3_ID,
        linked_task_id: TASK_1_ID,
        deleted_at: null,
      });
      mockTables.disbursements.set('disb-conflict-3', {
        id: 'disb-conflict-3',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_A_ID,
        task_id: TASK_3_ID,
        linked_task_id: TASK_1_ID,
        created_by: creatorUser.id,
        deleted_at: null,
      });

      const resT1 = await operationsService.getTaskRelated(TASK_1_ID, adminUser);
      expect(resT1.invoices.map((i) => i.id)).not.toContain('inv-conflict-1');
      expect(resT1.invoices.map((i) => i.id)).not.toContain('inv-conflict-3');
      expect(resT1.disbursements.map((d) => d.id)).not.toContain('disb-conflict-1');
      expect(resT1.disbursements.map((d) => d.id)).not.toContain('disb-conflict-3');

      const resT3 = await operationsService.getTaskRelated(TASK_3_ID, adminUser);
      expect(resT3.invoices.map((i) => i.id)).not.toContain('inv-conflict-3');
      expect(resT3.invoices.map((i) => i.id)).not.toContain('inv-conflict-1');
      expect(resT3.disbursements.map((d) => d.id)).not.toContain('disb-conflict-3');
      expect(resT3.disbursements.map((d) => d.id)).not.toContain('disb-conflict-1');
    });
  });

  describe('Boundary Exclusions: Deleted, Other-Entity, and Unrelated Work Requests', () => {
    it('excludes soft-deleted records from getTaskRelated across all 3 record types', async () => {
      mockTables.invoices.set('inv-deleted', {
        id: 'inv-deleted',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: TASK_1_ID,
        deleted_at: '2026-10-24T00:00:00Z',
      });
      mockTables.disbursements.set('disb-deleted', {
        id: 'disb-deleted',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: TASK_1_ID,
        created_by: creatorUser.id,
        deleted_at: '2026-10-24T00:00:00Z',
      });
      mockTables.transmittals.set('trans-deleted', {
        id: 'trans-deleted',
        entity_id: ENTITY_ATA,
        work_request_id: WR_A_ID,
        linked_task_id: TASK_1_ID,
        deleted_at: '2026-10-24T00:00:00Z',
      });

      const res = await operationsService.getTaskRelated(TASK_1_ID, adminUser);
      expect(res.invoices.map((i) => i.id)).not.toContain('inv-deleted');
      expect(res.disbursements.map((d) => d.id)).not.toContain('disb-deleted');
      expect(res.transmittals.map((t) => t.id)).not.toContain('trans-deleted');
    });

    it('excludes other-entity records when querying within active entity', async () => {
      mockTables.invoices.set('inv-lta', {
        id: 'inv-lta',
        entity_id: ENTITY_LTA,
        work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: TASK_1_ID,
        deleted_at: null,
      });
      mockTables.disbursements.set('disb-lta', {
        id: 'disb-lta',
        entity_id: ENTITY_LTA,
        linked_work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: TASK_1_ID,
        created_by: creatorUser.id,
        deleted_at: null,
      });
      mockTables.transmittals.set('trans-lta', {
        id: 'trans-lta',
        entity_id: ENTITY_LTA,
        work_request_id: WR_A_ID,
        linked_task_id: TASK_1_ID,
        deleted_at: null,
      });

      const res = await operationsService.getTaskRelated({
        id: TASK_1_ID,
        entityId: ENTITY_ATA,
        caller: adminUser,
      });
      expect(res.invoices.map((i) => i.id)).not.toContain('inv-lta');
      expect(res.disbursements.map((d) => d.id)).not.toContain('disb-lta');
      expect(res.transmittals.map((t) => t.id)).not.toContain('trans-lta');
    });

    it('isolates tasks belonging to completely unrelated work requests', async () => {
      mockTables.invoices.set('inv-wr-b', {
        id: 'inv-wr-b',
        entity_id: ENTITY_ATA,
        work_request_id: WR_B_ID,
        task_id: TASK_OTHER_WR_ID,
        linked_task_id: TASK_OTHER_WR_ID,
        deleted_at: null,
      });
      mockTables.disbursements.set('disb-wr-b', {
        id: 'disb-wr-b',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_B_ID,
        task_id: TASK_OTHER_WR_ID,
        linked_task_id: TASK_OTHER_WR_ID,
        created_by: creatorUser.id,
        deleted_at: null,
      });
      mockTables.transmittals.set('trans-wr-b', {
        id: 'trans-wr-b',
        entity_id: ENTITY_ATA,
        work_request_id: WR_B_ID,
        linked_task_id: TASK_OTHER_WR_ID,
        deleted_at: null,
      });

      // Query Task 1 (WR A)
      const resT1 = await operationsService.getTaskRelated(TASK_1_ID, adminUser);
      expect(resT1.invoices.map((i) => i.id)).not.toContain('inv-wr-b');
      expect(resT1.disbursements.map((d) => d.id)).not.toContain('disb-wr-b');
      expect(resT1.transmittals.map((t) => t.id)).not.toContain('trans-wr-b');

      // Query Task in WR B
      const resTB = await operationsService.getTaskRelated(TASK_OTHER_WR_ID, adminUser);
      expect(resTB.invoices.map((i) => i.id)).toEqual(['inv-wr-b']);
      expect(resTB.disbursements.map((d) => d.id)).toEqual(['disb-wr-b']);
      expect(resTB.transmittals.map((t) => t.id)).toEqual(['trans-wr-b']);
    });
  });

  describe('Role and Caller Visibility (Disbursements)', () => {
    beforeEach(() => {
      mockTables.disbursements.set('disb-by-creator', {
        id: 'disb-by-creator',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: TASK_1_ID,
        created_by: creatorUser.id,
        deleted_at: null,
      });
      mockTables.disbursements.set('disb-by-other-creator', {
        id: 'disb-by-other-creator',
        entity_id: ENTITY_ATA,
        linked_work_request_id: WR_A_ID,
        task_id: TASK_1_ID,
        linked_task_id: TASK_1_ID,
        created_by: otherCreatorUser.id,
        deleted_at: null,
      });
    });

    it('Admin caller receives all disbursements for the task', async () => {
      const res = await operationsService.getTaskRelated(TASK_1_ID, adminUser);
      const ids = res.disbursements.map((d) => d.id);
      expect(ids).toContain('disb-by-creator');
      expect(ids).toContain('disb-by-other-creator');
    });

    it('Assigned project member receives all disbursements for the task', async () => {
      mockTables.work_requests.get(WR_A_ID).assigned_to = creatorUser.id;
      const res = await operationsService.getTaskRelated(TASK_1_ID, creatorUser);
      const ids = res.disbursements.map((d) => d.id);
      expect(ids).toContain('disb-by-creator');
      expect(ids).toContain('disb-by-other-creator');
    });

    it('Accounting outsider without assignment receives empty disbursements (F01/F02 outsider denial)', async () => {
      const res = await operationsService.getTaskRelated(TASK_1_ID, accountingUser);
      expect(res.disbursements).toEqual([]);
    });

    it('Historical creator without current assignment receives empty disbursements (F10)', async () => {
      const res = await operationsService.getTaskRelated(TASK_1_ID, otherCreatorUser);
      expect(res.disbursements).toEqual([]);
    });

    it('Unrelated employee creator receives empty disbursements for the task', async () => {
      const res = await operationsService.getTaskRelated(TASK_1_ID, unrelatedStaffUser);
      expect(res.disbursements).toEqual([]);
    });
  });

  describe('Contract and Empty Response Shape', () => {
    it('returns standard shape { invoices: [], disbursements: [], transmittals: [] } for non-existent task', async () => {
      const res = await operationsService.getTaskRelated('non-existent-task-id', adminUser);
      expect(res).toEqual({
        invoices: [],
        disbursements: [],
        transmittals: [],
      });
    });

    it('returns standard shape for soft-deleted task', async () => {
      mockTables.tasks.set('task-deleted', {
        id: 'task-deleted',
        work_request_id: WR_A_ID,
        title: 'Deleted Task',
        deleted_at: '2026-10-24T00:00:00Z',
      });

      const res = await operationsService.getTaskRelated('task-deleted', adminUser);
      expect(res).toEqual({
        invoices: [],
        disbursements: [],
        transmittals: [],
      });
    });

    it('returns standard shape for task with missing work_request_id', async () => {
      mockTables.tasks.set('task-no-wr', {
        id: 'task-no-wr',
        work_request_id: null,
        title: 'Orphan Task',
        deleted_at: null,
      });

      const res = await operationsService.getTaskRelated('task-no-wr', adminUser);
      expect(res).toEqual({
        invoices: [],
        disbursements: [],
        transmittals: [],
      });
    });

    it('returns standard shape when parent work request is soft-deleted', async () => {
      mockTables.work_requests.set('wr-deleted', {
        id: 'wr-deleted',
        entity_id: ENTITY_ATA,
        deleted_at: '2026-10-24T00:00:00Z',
      });
      mockTables.tasks.set('task-in-deleted-wr', {
        id: 'task-in-deleted-wr',
        work_request_id: 'wr-deleted',
        deleted_at: null,
      });

      const res = await operationsService.getTaskRelated('task-in-deleted-wr', adminUser);
      expect(res).toEqual({
        invoices: [],
        disbursements: [],
        transmittals: [],
      });
    });
  });
});
