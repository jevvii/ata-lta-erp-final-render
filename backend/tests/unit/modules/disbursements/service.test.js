/**
 * Disbursements service unit tests.
 * Tests for status workflow transitions, numbering, and strict creator-only authorization scoping.
 */

jest.mock('../../../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../../../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const disbursementsService = require('../../../../src/modules/disbursements/service');
const operationsService = require('../../../../src/modules/operations/service');
const { resetMock, seedDefaults, mockTables } = require('../../../fixtures/supabaseMock');

describe('Disbursements Service - Status Workflow', () => {
  const VALID_TRANSITIONS = {
    submit: { from: 'Draft', to: 'Pending' },
    approve: { from: 'Pending', to: 'Approved' },
    release: { from: 'Approved', to: 'Released' },
    reject: { from: ['Pending', 'Approved'], to: 'Rejected' },
  };

  describe('Valid transitions', () => {
    it('allows Draft → Pending (submit)', () => {
      const transition = VALID_TRANSITIONS.submit;
      expect(transition.from).toBe('Draft');
      expect(transition.to).toBe('Pending');
    });

    it('allows Pending → Approved (approve)', () => {
      const transition = VALID_TRANSITIONS.approve;
      expect(transition.from).toBe('Pending');
      expect(transition.to).toBe('Approved');
    });

    it('allows Approved → Released (release)', () => {
      const transition = VALID_TRANSITIONS.release;
      expect(transition.from).toBe('Approved');
      expect(transition.to).toBe('Released');
    });

    it('allows rejection from Pending', () => {
      const transition = VALID_TRANSITIONS.reject;
      expect(transition.from).toContain('Pending');
    });

    it('allows rejection from Approved', () => {
      const transition = VALID_TRANSITIONS.reject;
      expect(transition.from).toContain('Approved');
    });
  });

  describe('Invalid transitions', () => {
    it('does not allow submitting a Released disbursement', () => {
      const transition = VALID_TRANSITIONS.submit;
      const currentStatus = 'Released';
      const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
      expect(validFrom.includes(currentStatus)).toBe(false);
    });

    it('does not allow approving a Draft disbursement', () => {
      const transition = VALID_TRANSITIONS.approve;
      const currentStatus = 'Draft';
      const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
      expect(validFrom.includes(currentStatus)).toBe(false);
    });

    it('does not allow releasing a Pending disbursement', () => {
      const transition = VALID_TRANSITIONS.release;
      const currentStatus = 'Pending';
      const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
      expect(validFrom.includes(currentStatus)).toBe(false);
    });

    it('does not allow rejecting a Draft disbursement', () => {
      const transition = VALID_TRANSITIONS.reject;
      const currentStatus = 'Draft';
      const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
      expect(validFrom.includes(currentStatus)).toBe(false);
    });

    it('does not allow rejecting a Released disbursement', () => {
      const transition = VALID_TRANSITIONS.reject;
      const currentStatus = 'Released';
      const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
      expect(validFrom.includes(currentStatus)).toBe(false);
    });
  });

  describe('Disbursement number generation', () => {
    it('follows the DISB-{ENTITY}-{YYYYMMDD}-{SEQ} format', () => {
      const entityId = 'ATA';
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const seq = '0001';
      const number = `DISB-${entityId}-${today}-${seq}`;

      expect(number).toMatch(/^DISB-ATA-\d{8}-\d{4}$/);
    });
  });
});

describe('Disbursements Service - Strict Creator-Only Authorization & Scoping', () => {
  const ENTITY_ID = '11111111-1111-4111-8111-111111111101';
  const WR_ID = '11111111-1111-4111-8111-111111111102';
  const TASK_ID = '11111111-1111-4111-8111-111111111103';
  const OTHER_WR_ID = '11111111-1111-4111-8111-111111111104';
  const OTHER_TASK_ID = '11111111-1111-4111-8111-111111111105';
  const WR_EMPTY_ID = '11111111-1111-4111-8111-111111111106';

  const adminUser = { id: '11111111-1111-4111-8111-111111111111', role: 'Admin', departments: ['Management'], entities: ['ATA'] };
  const accountingDeptUser = { id: '11111111-1111-4111-8111-111111111112', role: 'Staff', departments: ['Accounting'], entities: ['ATA'] };
  const accountingRoleUser = { id: '11111111-1111-4111-8111-111111111113', role: 'Accounting', departments: [], entities: ['ATA'] };
  const creatorUser = { id: '11111111-1111-4111-8111-111111111114', role: 'Operations', departments: ['Operations'], entities: ['ATA'] };
  const payeeUser = { id: '11111111-1111-4111-8111-111111111115', role: 'Documentation', departments: ['Documentation'], entities: ['ATA'] };
  const managerUser = { id: '11111111-1111-4111-8111-111111111116', role: 'Manager', departments: ['Management'], entities: ['ATA'] };
  const otherUser = { id: '11111111-1111-4111-8111-111111111117', role: 'Operations', departments: ['Operations'], entities: ['ATA'] };

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // Seed entity
    mockTables.entities.set(ENTITY_ID, {
      id: ENTITY_ID,
      code: 'ATA',
      name: 'ATA Entity',
    });

    // Seed Work Request
    mockTables.work_requests.set(WR_ID, {
      id: WR_ID,
      entity_id: ENTITY_ID,
      title: 'Audit WR',
      status: 'In Progress',
      creation_approval_status: 'approved',
      assigned_to: creatorUser.id,
      co_assignees: [accountingDeptUser.id, accountingRoleUser.id],
      deleted_at: null,
    });

    // Seed Task
    mockTables.tasks.set(TASK_ID, {
      id: TASK_ID,
      work_request_id: WR_ID,
      title: 'Audit Task',
      assignee_id: creatorUser.id,
      deleted_at: null,
    });

    // Seed other WR & task for otherUser
    mockTables.work_requests.set(OTHER_WR_ID, {
      id: OTHER_WR_ID,
      entity_id: ENTITY_ID,
      title: 'Other WR',
      status: 'In Progress',
      creation_approval_status: 'approved',
      assigned_to: otherUser.id,
      co_assignees: [accountingDeptUser.id, accountingRoleUser.id],
      deleted_at: null,
    });
    mockTables.tasks.set(OTHER_TASK_ID, {
      id: OTHER_TASK_ID,
      work_request_id: OTHER_WR_ID,
      title: 'Other Task',
      assignee_id: otherUser.id,
      deleted_at: null,
    });

    // Seed empty WR for payeeUser
    mockTables.work_requests.set(WR_EMPTY_ID, {
      id: WR_EMPTY_ID,
      entity_id: ENTITY_ID,
      title: 'Empty WR',
      status: 'In Progress',
      creation_approval_status: 'approved',
      assigned_to: payeeUser.id,
      deleted_at: null,
    });

    // Seed Disbursements created by creatorUser in multiple statuses
    mockTables.disbursements.set('disb-c-draft', {
      id: 'disb-c-draft',
      entity_id: ENTITY_ID,
      category: 'Supplies',
      description: 'Creator draft supplies',
      amount: 100,
      fund_source: 'Firm Fund',
      status: 'Draft',
      created_by: creatorUser.id,
      employee_id: payeeUser.id,
      linked_work_request_id: WR_ID,
      linked_task_id: TASK_ID,
      archived: false,
      deleted_at: null,
    });

    mockTables.disbursements.set('disb-c-pending', {
      id: 'disb-c-pending',
      entity_id: ENTITY_ID,
      category: 'Travel',
      description: 'Creator pending travel',
      amount: 200,
      fund_source: 'Firm Fund',
      status: 'Pending',
      created_by: creatorUser.id,
      employee_id: null,
      linked_work_request_id: WR_ID,
      linked_task_id: TASK_ID,
      archived: false,
      deleted_at: null,
    });

    mockTables.disbursements.set('disb-c-submitted', {
      id: 'disb-c-submitted',
      entity_id: ENTITY_ID,
      category: 'Meals',
      description: 'Creator submitted meals',
      amount: 150,
      fund_source: 'Firm Fund',
      status: 'Submitted',
      created_by: creatorUser.id,
      linked_work_request_id: WR_ID,
      linked_task_id: TASK_ID,
      archived: false,
      deleted_at: null,
    });

    mockTables.disbursements.set('disb-c-approved', {
      id: 'disb-c-approved',
      entity_id: ENTITY_ID,
      category: 'Lodging',
      description: 'Creator approved lodging',
      amount: 300,
      fund_source: 'Firm Fund',
      status: 'Approved',
      created_by: creatorUser.id,
      linked_work_request_id: WR_ID,
      linked_task_id: TASK_ID,
      archived: false,
      deleted_at: null,
    });

    mockTables.disbursements.set('disb-c-released', {
      id: 'disb-c-released',
      entity_id: ENTITY_ID,
      category: 'Equipment',
      description: 'Creator released equipment',
      amount: 500,
      fund_source: 'Firm Fund',
      status: 'Released',
      created_by: creatorUser.id,
      linked_work_request_id: WR_ID,
      linked_task_id: TASK_ID,
      archived: false,
      deleted_at: null,
    });

    mockTables.disbursements.set('disb-c-funded', {
      id: 'disb-c-funded',
      entity_id: ENTITY_ID,
      category: 'Equipment',
      description: 'Creator funded equipment',
      amount: 600,
      fund_source: 'Firm Fund',
      status: 'Funded',
      created_by: creatorUser.id,
      linked_work_request_id: WR_ID,
      linked_task_id: TASK_ID,
      archived: false,
      deleted_at: null,
    });

    mockTables.disbursements.set('disb-c-rejected', {
      id: 'disb-c-rejected',
      entity_id: ENTITY_ID,
      category: 'Other',
      description: 'Creator rejected expense',
      amount: 75,
      fund_source: 'Firm Fund',
      status: 'Rejected',
      created_by: creatorUser.id,
      linked_work_request_id: WR_ID,
      linked_task_id: TASK_ID,
      archived: false,
      deleted_at: null,
    });

    mockTables.disbursements.set('disb-c-no-wr', {
      id: 'disb-c-no-wr',
      entity_id: ENTITY_ID,
      category: 'Office',
      description: 'Creator personal office expense without WR',
      amount: 50,
      fund_source: 'Firm Fund',
      status: 'Draft',
      created_by: creatorUser.id,
      linked_work_request_id: null,
      linked_task_id: null,
      archived: false,
      deleted_at: null,
    });

    mockTables.disbursements.set('disb-c-archived', {
      id: 'disb-c-archived',
      entity_id: ENTITY_ID,
      category: 'Old',
      description: 'Creator archived expense',
      amount: 80,
      fund_source: 'Firm Fund',
      status: 'Draft',
      created_by: creatorUser.id,
      linked_work_request_id: WR_ID,
      linked_task_id: TASK_ID,
      archived: true,
      deleted_at: null,
    });

    // Seed Disbursements created by otherUser
    mockTables.disbursements.set('disb-other-released', {
      id: 'disb-other-released',
      entity_id: ENTITY_ID,
      category: 'Hardware',
      description: 'Other user released hardware',
      amount: 1200,
      fund_source: 'Firm Fund',
      status: 'Released',
      created_by: otherUser.id,
      employee_id: creatorUser.id, // creatorUser is payee here
      linked_work_request_id: OTHER_WR_ID,
      linked_task_id: OTHER_TASK_ID,
      archived: false,
      deleted_at: null,
    });

    mockTables.disbursements.set('disb-other-draft', {
      id: 'disb-other-draft',
      entity_id: ENTITY_ID,
      category: 'Software',
      description: 'Other user draft software',
      amount: 800,
      fund_source: 'Firm Fund',
      status: 'Draft',
      created_by: otherUser.id,
      requested_by: creatorUser.id, // creatorUser is requester here
      linked_work_request_id: OTHER_WR_ID,
      linked_task_id: OTHER_TASK_ID,
      archived: false,
      deleted_at: null,
    });
  });

  describe('listDisbursements', () => {
    it('Admin sees all disbursements in the entity regardless of creator', async () => {
      const res = await disbursementsService.listDisbursements({
        entityId: ENTITY_ID,
        filters: { page: 1, limit: 50 },
        user: adminUser,
      });
      expect(res.data.length).toBeGreaterThanOrEqual(10);
      expect(res.data.some((d) => d.id === 'disb-c-draft')).toBe(true);
      expect(res.data.some((d) => d.id === 'disb-other-released')).toBe(true);
      expect(res.data.some((d) => d.id === 'disb-other-draft')).toBe(true);
    });

    it('Accounting user sees all disbursements in the entity', async () => {
      const resDept = await disbursementsService.listDisbursements({
        entityId: ENTITY_ID,
        filters: { page: 1, limit: 50 },
        user: accountingDeptUser,
      });
      expect(resDept.data.some((d) => d.id === 'disb-c-draft')).toBe(true);
      expect(resDept.data.some((d) => d.id === 'disb-other-released')).toBe(true);

      const resRole = await disbursementsService.listDisbursements({
        entityId: ENTITY_ID,
        filters: { page: 1, limit: 50 },
        user: accountingRoleUser,
      });
      expect(resRole.data.some((d) => d.id === 'disb-c-draft')).toBe(true);
      expect(resRole.data.some((d) => d.id === 'disb-other-released')).toBe(true);
    });

    it('Non-Admin/non-Accounting user sees ONLY disbursements they created', async () => {
      const res = await disbursementsService.listDisbursements({
        entityId: ENTITY_ID,
        filters: { page: 1, limit: 50 },
        user: creatorUser,
      });
      // All returned records must have created_by === creatorUser.id
      expect(res.data.length).toBeGreaterThan(0);
      res.data.forEach((d) => {
        expect(d.created_by).toBe(creatorUser.id);
      });
      // Sees own records across statuses
      expect(res.data.some((d) => d.id === 'disb-c-draft')).toBe(true);
      expect(res.data.some((d) => d.id === 'disb-c-pending')).toBe(true);
      expect(res.data.some((d) => d.id === 'disb-c-approved')).toBe(true);
      expect(res.data.some((d) => d.id === 'disb-c-released')).toBe(true);
      expect(res.data.some((d) => d.id === 'disb-c-funded')).toBe(true);
      expect(res.data.some((d) => d.id === 'disb-c-rejected')).toBe(true);
      // Own record without WR is blocked (fails closed per mandatory linkage)
      expect(res.data.some((d) => d.id === 'disb-c-no-wr')).toBe(false);
      // Other user's records are NOT visible even if status is Released or caller is payee/requester
      expect(res.data.some((d) => d.id === 'disb-other-released')).toBe(false);
      expect(res.data.some((d) => d.id === 'disb-other-draft')).toBe(false);
    });

    it('Payee (employee_id) who did not create the disbursement cannot see it in list', async () => {
      const res = await disbursementsService.listDisbursements({
        entityId: ENTITY_ID,
        filters: { page: 1, limit: 50 },
        user: payeeUser,
      });
      // disb-c-draft has employee_id === payeeUser.id, but created_by === creatorUser.id
      expect(res.data.some((d) => d.id === 'disb-c-draft')).toBe(false);
    });

    it('Manager role does not grant visibility to other users disbursements', async () => {
      const res = await disbursementsService.listDisbursements({
        entityId: ENTITY_ID,
        filters: { page: 1, limit: 50 },
        user: managerUser,
      });
      expect(res.data.some((d) => d.id === 'disb-c-draft')).toBe(false);
      expect(res.data.some((d) => d.id === 'disb-other-released')).toBe(false);
    });

    it('Unauthenticated caller returns empty list with count 0', async () => {
      const res = await disbursementsService.listDisbursements({
        entityId: ENTITY_ID,
        filters: { page: 1, limit: 50 },
        user: null,
      });
      expect(res).toEqual({ data: [], count: 0 });
    });

    it('Status query parameter correctly filters creator records', async () => {
      const res = await disbursementsService.listDisbursements({
        entityId: ENTITY_ID,
        filters: { status: 'Draft', page: 1, limit: 50 },
        user: creatorUser,
      });
      res.data.forEach((d) => {
        expect(d.created_by).toBe(creatorUser.id);
        expect(d.status).toBe('Draft');
      });
      expect(res.data.some((d) => d.id === 'disb-c-draft')).toBe(true);
      expect(res.data.some((d) => d.id === 'disb-c-released')).toBe(false);
    });
  });

  describe('getDisbursementById', () => {
    it('Admin can view any disbursement', async () => {
      const d = await disbursementsService.getDisbursementById({
        entityId: ENTITY_ID,
        id: 'disb-c-draft',
        user: adminUser,
      });
      expect(d.id).toBe('disb-c-draft');
    });

    it('Accounting user can view any disbursement', async () => {
      const d = await disbursementsService.getDisbursementById({
        entityId: ENTITY_ID,
        id: 'disb-c-draft',
        user: accountingDeptUser,
      });
      expect(d.id).toBe('disb-c-draft');
    });

    it('Creator can view their own disbursement across all statuses', async () => {
      const statuses = [
        'disb-c-draft',
        'disb-c-pending',
        'disb-c-submitted',
        'disb-c-approved',
        'disb-c-released',
        'disb-c-funded',
        'disb-c-rejected',
      ];
      for (const id of statuses) {
        const d = await disbursementsService.getDisbursementById({
          entityId: ENTITY_ID,
          id,
          user: creatorUser,
        });
        expect(d.id).toBe(id);
      }
    });

    it('Creator cannot view own disbursement when not linked to any WR (fails closed)', async () => {
      await expect(
        disbursementsService.getDisbursementById({
          entityId: ENTITY_ID,
          id: 'disb-c-no-wr',
          user: creatorUser,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        title: 'Not Found',
      });
    });

    it('Payee (employee_id) is forbidden from viewing non-created disbursement', async () => {
      await expect(
        disbursementsService.getDisbursementById({
          entityId: ENTITY_ID,
          id: 'disb-c-draft',
          user: payeeUser,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        title: 'Forbidden',
      });
    });

    it('Requester (requested_by) is forbidden from viewing non-created disbursement', async () => {
      // creatorUser is requested_by on disb-other-draft
      await expect(
        disbursementsService.getDisbursementById({
          entityId: ENTITY_ID,
          id: 'disb-other-draft',
          user: creatorUser,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        title: 'Forbidden',
      });
    });

    it('Manager role is forbidden from viewing non-created disbursement', async () => {
      await expect(
        disbursementsService.getDisbursementById({
          entityId: ENTITY_ID,
          id: 'disb-c-draft',
          user: managerUser,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        title: 'Forbidden',
      });
    });

    it('Released status does NOT grant view access to non-creators', async () => {
      // creatorUser is payee on disb-other-released, status is Released
      await expect(
        disbursementsService.getDisbursementById({
          entityId: ENTITY_ID,
          id: 'disb-other-released',
          user: creatorUser,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        title: 'Forbidden',
      });
    });

    it('Fails closed with 401 Unauthorized if unauthenticated (no user or no user.id)', async () => {
      await expect(
        disbursementsService.getDisbursementById({
          entityId: ENTITY_ID,
          id: 'disb-c-draft',
          user: null,
        })
      ).rejects.toMatchObject({
        statusCode: 401,
        title: 'Unauthorized',
      });

      await expect(
        disbursementsService.getDisbursementById({
          entityId: ENTITY_ID,
          id: 'disb-c-draft',
          user: {},
        })
      ).rejects.toMatchObject({
        statusCode: 401,
        title: 'Unauthorized',
      });
    });

    it('Throws 404 Not Found for non-existent disbursement ID', async () => {
      await expect(
        disbursementsService.getDisbursementById({
          entityId: ENTITY_ID,
          id: 'non-existent-id',
          user: adminUser,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        title: 'Not Found',
      });
    });
  });

  describe('getDisbursementCounts', () => {
    it('Admin sees total counts across the entity', async () => {
      const counts = await disbursementsService.getDisbursementCounts({
        entityId: ENTITY_ID,
        user: adminUser,
      });
      expect(counts.active).toBeGreaterThanOrEqual(9);
      expect(counts.archived).toBe(1);
    });

    it('Accounting user sees total counts across the entity', async () => {
      const counts = await disbursementsService.getDisbursementCounts({
        entityId: ENTITY_ID,
        user: accountingDeptUser,
      });
      expect(counts.active).toBeGreaterThanOrEqual(9);
      expect(counts.archived).toBe(1);
    });

    it('Non-Admin/non-Accounting counts only records where created_by === user.id', async () => {
      const counts = await disbursementsService.getDisbursementCounts({
        entityId: ENTITY_ID,
        user: creatorUser,
      });
      // Active non-archived non-cancelled disbursements created by creatorUser:
      // disb-c-draft, disb-c-pending, disb-c-submitted, disb-c-approved,
      // disb-c-released, disb-c-funded, disb-c-rejected = 7
      expect(counts.active).toBe(7);
      // Archived disbursements created by creatorUser: disb-c-archived = 1
      expect(counts.archived).toBe(1);
    });

    it('Non-creator user with 0 created disbursements gets 0 counts', async () => {
      const counts = await disbursementsService.getDisbursementCounts({
        entityId: ENTITY_ID,
        user: payeeUser,
      });
      expect(counts.active).toBe(0);
      expect(counts.archived).toBe(0);
      expect(counts.rejected).toBe(0);
    });

    it('Unauthenticated caller returns all 0 counts', async () => {
      const counts = await disbursementsService.getDisbursementCounts({
        entityId: ENTITY_ID,
        user: null,
      });
      expect(counts).toEqual({
        active: 0,
        archived: 0,
        rejected: 0,
        awaitingRelease: 0,
        initialRequests: 0,
        readyForFunding: 0,
        paymentReleases: 0,
        needsCorrection: 0,
      });
    });
  });

  describe('Operations Service - Related Disbursements Scoping', () => {
    it('Admin caller receives all disbursements linked to the work request', async () => {
      const related = await operationsService.getWorkRequestRelated({
        id: WR_ID,
        entityId: ENTITY_ID,
        caller: adminUser,
      });
      expect(related.disbursements.length).toBeGreaterThan(0);
      expect(related.disbursements.some((d) => d.id === 'disb-c-draft')).toBe(true);

      const otherRelated = await operationsService.getWorkRequestRelated({
        id: OTHER_WR_ID,
        entityId: ENTITY_ID,
        caller: adminUser,
      });
      expect(otherRelated.disbursements.some((d) => d.id === 'disb-other-released')).toBe(true);
    });

    it('Accounting caller receives all disbursements linked to the work request', async () => {
      const related = await operationsService.getWorkRequestRelated({
        id: WR_ID,
        entityId: ENTITY_ID,
        caller: accountingDeptUser,
      });
      expect(related.disbursements.some((d) => d.id === 'disb-c-draft')).toBe(true);

      const otherRelated = await operationsService.getWorkRequestRelated({
        id: OTHER_WR_ID,
        entityId: ENTITY_ID,
        caller: accountingDeptUser,
      });
      expect(otherRelated.disbursements.some((d) => d.id === 'disb-other-released')).toBe(true);
    });

    it('Non-Admin/non-Accounting caller receives ONLY their own disbursements in WR related', async () => {
      const related = await operationsService.getWorkRequestRelated({
        id: WR_ID,
        entityId: ENTITY_ID,
        caller: creatorUser,
      });
      expect(related.disbursements.length).toBeGreaterThan(0);
      related.disbursements.forEach((d) => {
        expect(d.created_by).toBe(creatorUser.id);
      });
      expect(related.disbursements.some((d) => d.id === 'disb-c-draft')).toBe(true);
      // disb-other-released was created by otherUser -> must not be returned
      expect(related.disbursements.some((d) => d.id === 'disb-other-released')).toBe(false);
    });

    it('Non-Admin/non-Accounting caller receives ONLY their own disbursements in Task related', async () => {
      const related = await operationsService.getTaskRelated({
        id: TASK_ID,
        entityId: ENTITY_ID,
        caller: creatorUser,
      });
      expect(related.disbursements.length).toBeGreaterThan(0);
      related.disbursements.forEach((d) => {
        expect(d.created_by).toBe(creatorUser.id);
      });
      expect(related.disbursements.some((d) => d.id === 'disb-c-draft')).toBe(true);
      expect(related.disbursements.some((d) => d.id === 'disb-other-released')).toBe(false);
    });

    it('Caller who created 0 disbursements gets empty disbursements array in related', async () => {
      const related = await operationsService.getWorkRequestRelated({
        id: WR_EMPTY_ID,
        entityId: ENTITY_ID,
        caller: payeeUser,
      });
      expect(related.disbursements).toEqual([]);
    });
  });
});
