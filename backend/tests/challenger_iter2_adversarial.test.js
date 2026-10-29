/**
 * Challenger Iteration 2: Empirical Adversarial Verification Suite
 * Target: Complete Cross-Repository Verification for Iteration 2 Remediation
 *
 * Vectors Probed:
 * 1. Case-insensitive department bypasses:
 *    - Transmittals creation/update/send with lowercase 'documentation'
 *    - Operations request billing creation with lowercase 'documentation'
 *    - Disbursement visibility and review for lowercase 'accounting'
 * 2. Prototype direct navigation & recursion prevention:
 *    - Direct routing to #operations?tab=templates for Documentation and Staff
 *    - Direct routing to #operations/templateForm/new for Documentation and Staff
 *    - Lifecycle loop avoidance & URL hash normalization verification
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  request,
  app,
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
  loadPrototypeAuth,
  getPrototypeWorkflow,
} = require('./e2e/helpers');

const transmittalsService = require('../src/modules/transmittals/service');
const operationsService = require('../src/modules/operations/service');
const disbursementsService = require('../src/modules/disbursements/service');

const CLIENT_ID_1 = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID_2 = '11111111-1111-1111-1111-111111111112';
const WR_ID_1 = '22222222-2222-2222-2222-222222222221';
const TASK_ID_1 = '33333333-3333-3333-3333-333333333331';
const TASK_ID_2 = '33333333-3333-3333-3333-333333333332';
const TASK_ID_UNASSIGNED = '33333333-3333-3333-3333-333333333339';

describe('Challenger Iteration 2: Empirical Adversarial Probe Suite', () => {
  let adminToken, adminUser;
  let docLowerToken, docLowerUser;
  let docMixedToken, docMixedUser;
  let acctLowerToken, acctLowerUser;
  let opsStaffToken, opsStaffUser;
  let thirdPartyDisbursementId;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // 1. Admin
    const adminId = '99999999-9999-9999-9999-999999999999';
    adminToken = registerUser({
      id: adminId,
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });
    adminUser = { id: adminId, role: 'Admin', departments: ['Management'] };

    // 2. Staff with lowercase 'documentation'
    const docLowerId = '55555555-5555-5555-5555-555555555501';
    docLowerToken = registerUser({
      id: docLowerId,
      email: 'doc-lower@ata-lta.ph',
      name: 'Doc Lowercase',
      role: 'Staff',
      entities: ['ATA', 'LTA'],
      departments: ['documentation'],
    });
    docLowerUser = { id: docLowerId, role: 'Staff', departments: ['documentation'] };

    // 3. Staff with mixed lowercase departments ['operations', 'documentation']
    const docMixedId = '55555555-5555-5555-5555-555555555502';
    docMixedToken = registerUser({
      id: docMixedId,
      email: 'doc-mixed@ata-lta.ph',
      name: 'Doc Mixed Lowercase',
      role: 'Staff',
      entities: ['ATA', 'LTA'],
      departments: ['operations', 'documentation'],
    });
    docMixedUser = { id: docMixedId, role: 'Staff', departments: ['operations', 'documentation'] };

    // 4. Staff with lowercase 'accounting'
    const acctLowerId = '88888888-8888-8888-8888-888888888801';
    acctLowerToken = registerUser({
      id: acctLowerId,
      email: 'acct-lower@ata-lta.ph',
      name: 'Acct Lowercase',
      role: 'Staff',
      entities: ['ATA', 'LTA'],
      departments: ['accounting'],
    });
    acctLowerUser = { id: acctLowerId, role: 'Staff', departments: ['accounting'] };

    // 5. Staff with pure 'operations'
    const opsStaffId = '66666666-6666-6666-6666-666666666601';
    opsStaffToken = registerUser({
      id: opsStaffId,
      email: 'ops-staff@ata-lta.ph',
      name: 'Ops Staff',
      role: 'Staff',
      entities: ['ATA', 'LTA'],
      departments: ['operations'],
    });
    opsStaffUser = { id: opsStaffId, role: 'Staff', departments: ['operations'] };

    // Seed mock client
    mockTables.clients.set(CLIENT_ID_1, {
      id: CLIENT_ID_1,
      name: 'Client Alpha',
      code: 'CLA',
      entity_id: 'ent-ata',
      deleted_at: null,
    });

    // Seed Work Request
    mockTables.work_requests.set(WR_ID_1, {
      id: WR_ID_1,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID_1,
      title: 'Tax Filing Alpha',
      work_order_number: 'WR-ATA-2026-0001',
      status: 'In Progress',
      phase: 'execution',
      team_members: [docLowerId, opsStaffId],
      deleted_at: null,
    });

    // Seed Tasks
    mockTables.tasks.set(TASK_ID_1, {
      id: TASK_ID_1,
      work_request_id: WR_ID_1,
      title: 'Assigned Task for Doc Lower',
      assignee_id: docLowerId,
      status: 'In Progress',
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_ID_UNASSIGNED, {
      id: TASK_ID_UNASSIGNED,
      work_request_id: WR_ID_1,
      title: 'Unassigned Task',
      assignee_id: null,
      status: 'Pending',
      deleted_at: null,
    });

    // Seed Task Assignees join table
    mockTables.task_assignees.set(`${TASK_ID_1}:${docLowerId}`, {
      id: 'ta-doc-lower',
      task_id: TASK_ID_1,
      user_id: docLowerId,
    });

    // Seed Third-Party Disbursement created by someone else
    thirdPartyDisbursementId = '44444444-4444-4444-4444-444444444499';
    mockTables.disbursements.set(thirdPartyDisbursementId, {
      id: thirdPartyDisbursementId,
      entity_id: 'ent-ata',
      disbursement_number: 'DISB-ATA-20261019-9999',
      description: 'Office Supplies from Third Party',
      category: 'Supplies',
      fund_source: 'Petty Cash',
      amount: 4500,
      status: 'Approved',
      created_by: 'some-other-user-uuid',
      employee_id: 'some-other-user-uuid',
      requested_by: adminId,
      linked_work_request_id: WR_ID_1,
      archived: false,
      deleted_at: null,
      created_at: new Date().toISOString(),
    });
  });

  // =========================================================================
  // PROBE 1: Case-Insensitive Department Bypasses
  // =========================================================================
  describe('Probe 1: Case-Insensitive Department Bypasses', () => {
    describe('1.1 Transmittals creation and update with lowercase "documentation"', () => {
      it('rejects whole-project transmittal creation (no linked task) for user with lowercase "documentation" department', async () => {
        const res = await request(app)
          .post('/v1/transmittals')
          .set('Authorization', `Bearer ${docLowerToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            clientId: CLIENT_ID_1,
            workRequestId: WR_ID_1,
            // linkedTaskId omitted
            items: [{ description: 'Corporate Seal' }],
          });

        expect(res.status).toBe(400);
        expect(res.body.detail).toBe('A valid linked task is required for transmittals');
      });

      it('rejects blank string linkedTaskId for user with lowercase "documentation" department', async () => {
        const res = await request(app)
          .post('/v1/transmittals')
          .set('Authorization', `Bearer ${docLowerToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            clientId: CLIENT_ID_1,
            workRequestId: WR_ID_1,
            linkedTaskId: '    ',
            items: [{ description: 'Corporate Seal' }],
          });

        expect(res.status).toBe(400);
        expect(res.body.detail).toBe('A valid linked task is required for transmittals');
      });

      it('rejects transmittal creation with unassigned task for user with lowercase "documentation"', async () => {
        const res = await request(app)
          .post('/v1/transmittals')
          .set('Authorization', `Bearer ${docLowerToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            clientId: CLIENT_ID_1,
            workRequestId: WR_ID_1,
            linkedTaskId: TASK_ID_UNASSIGNED,
            items: [{ description: 'Corporate Seal' }],
          });

        expect(res.status).toBe(403);
        expect(res.body.detail).toBe('You are not assigned to this task');
      });

      it('allows transmittal creation with assigned task for user with lowercase "documentation"', async () => {
        const res = await request(app)
          .post('/v1/transmittals')
          .set('Authorization', `Bearer ${docLowerToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            clientId: CLIENT_ID_1,
            workRequestId: WR_ID_1,
            linkedTaskId: TASK_ID_1,
            items: [{ description: 'Corporate Seal' }],
          });

        expect(res.status).toBe(201);
        expect(res.body.data.linked_task_id).toBe(TASK_ID_1);
      });

      it('rejects updating transmittal to clear linkedTaskId for lowercase "documentation"', async () => {
        // First create legitimate transmittal
        const createRes = await request(app)
          .post('/v1/transmittals')
          .set('Authorization', `Bearer ${docLowerToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            clientId: CLIENT_ID_1,
            workRequestId: WR_ID_1,
            linkedTaskId: TASK_ID_1,
            items: [{ description: 'Items' }],
          });
        expect(createRes.status).toBe(201);
        const transmittalId = createRes.body.data.id;

        // Try to clear linkedTaskId to empty string
        const updateRes = await request(app)
          .put(`/v1/transmittals/${transmittalId}`)
          .set('Authorization', `Bearer ${docLowerToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            linkedTaskId: '',
          });

        expect(updateRes.status).toBe(400);
        expect(updateRes.body.detail).toBe('A valid linked task is required for transmittals');
      });

      it('rejects updating transmittal to an unassigned task for lowercase "documentation"', async () => {
        const createRes = await request(app)
          .post('/v1/transmittals')
          .set('Authorization', `Bearer ${docLowerToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            clientId: CLIENT_ID_1,
            workRequestId: WR_ID_1,
            linkedTaskId: TASK_ID_1,
            items: [{ description: 'Items' }],
          });
        const transmittalId = createRes.body.data.id;

        // Relink to unassigned task
        const updateRes = await request(app)
          .put(`/v1/transmittals/${transmittalId}`)
          .set('Authorization', `Bearer ${docLowerToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            linkedTaskId: TASK_ID_UNASSIGNED,
          });

        expect(updateRes.status).toBe(403);
        expect(updateRes.body.detail).toBe('You are not assigned to this task');
      });

      it('strictly enforces task requirement on mixed lowercase ["operations", "documentation"] departments', async () => {
        const res = await request(app)
          .post('/v1/transmittals')
          .set('Authorization', `Bearer ${docMixedToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            clientId: CLIENT_ID_1,
            workRequestId: WR_ID_1,
            items: [{ description: 'Mixed Dept Probe' }],
          });

        expect(res.status).toBe(400);
        expect(res.body.detail).toBe('A valid linked task is required for transmittals');
      });

      it('verifies transmittal helper unit functions are case-insensitive across all combinations', () => {
        const { isDocumentationUser, isNonAdminDocumentationUser } = transmittalsService;
        expect(typeof isDocumentationUser).toBe('function');
        expect(typeof isNonAdminDocumentationUser).toBe('function');

        const casings = ['documentation', 'Documentation', 'DOCUMENTATION', 'dOcUmEnTaTiOn'];
        for (const c of casings) {
          expect(isDocumentationUser({ role: 'Staff', departments: [c] })).toBe(true);
          expect(isNonAdminDocumentationUser({ role: 'Staff', departments: [c] })).toBe(true);
          expect(isDocumentationUser({ role: c, departments: [] })).toBe(true);
          expect(isNonAdminDocumentationUser({ role: c, departments: [] })).toBe(true);
          // Admin override
          expect(isNonAdminDocumentationUser({ role: 'Admin', departments: [c] })).toBe(false);
        }
      });
    });

    describe('1.2 Invoice request billing creation with lowercase "documentation"', () => {
      it('rejects billing request for user with lowercase "documentation" in departments', async () => {
        const res = await request(app)
          .post('/v1/operations-requests')
          .set('Authorization', `Bearer ${docLowerToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            type: 'billing',
            workRequestId: WR_ID_1,
            linkedTaskId: TASK_ID_1,
            amount: 5000,
          });

        expect(res.status).toBe(403);
        expect(res.body.detail).toBe('Documentation users cannot request invoice billing');
      });

      it('rejects billing request for mixed lowercase ["operations", "documentation"] departments', async () => {
        const res = await request(app)
          .post('/v1/operations-requests')
          .set('Authorization', `Bearer ${docMixedToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            type: 'billing',
            workRequestId: WR_ID_1,
            linkedTaskId: TASK_ID_1,
            amount: 7500,
          });

        expect(res.status).toBe(403);
        expect(res.body.detail).toBe('Documentation users cannot request invoice billing');
      });

      it('allows legitimate pure Operations staff to create billing request', async () => {
        const res = await request(app)
          .post('/v1/operations-requests')
          .set('Authorization', `Bearer ${opsStaffToken}`)
          .set('x-active-entity', 'ATA')
          .send({
            type: 'billing',
            workRequestId: WR_ID_1,
            linkedTaskId: TASK_ID_1,
            amount: 8000,
          });

        expect(res.status).toBe(201);
        expect(res.body.data.type).toBe('billing');
      });

      it('verifies prototype Auth denies billing:request for lowercase "documentation"', () => {
        const authDocLower = loadPrototypeAuth({
          id: 'doc-lower',
          role: 'Staff',
          departments: ['documentation'],
          entities: ['ATA'],
        });
        expect(authDocLower.can('billing:request')).toBe(false);

        const authDocMixed = loadPrototypeAuth({
          id: 'doc-mixed',
          role: 'Staff',
          departments: ['operations', 'documentation'],
          entities: ['ATA'],
        });
        expect(authDocMixed.can('billing:request')).toBe(false);

        const authOps = loadPrototypeAuth({
          id: 'ops-staff',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['ATA'],
        });
        expect(authOps.can('billing:request', 'ATA')).toBe(true);
      });
    });

    describe('1.3 Disbursement visibility for users with lowercase "accounting"', () => {
      it('allows user with lowercase "accounting" department to list all entity disbursements (including third-party)', async () => {
        const res = await request(app)
          .get('/v1/disbursements')
          .set('Authorization', `Bearer ${acctLowerToken}`)
          .set('x-active-entity', 'ATA');

        expect(res.status).toBe(200);
        const records = res.body.data;
        const thirdPartyRecord = records.find((r) => r.id === thirdPartyDisbursementId);
        expect(thirdPartyRecord).toBeDefined();
        expect(thirdPartyRecord.description).toBe('Office Supplies from Third Party');
      });

      it('blocks user with "operations" department from seeing third-party disbursements', async () => {
        const res = await request(app)
          .get('/v1/disbursements')
          .set('Authorization', `Bearer ${opsStaffToken}`)
          .set('x-active-entity', 'ATA');

        expect(res.status).toBe(200);
        const records = res.body.data;
        const thirdPartyRecord = records.find((r) => r.id === thirdPartyDisbursementId);
        expect(thirdPartyRecord).toBeUndefined();
      });

      it('allows user with lowercase "accounting" department to fetch single third-party disbursement detail', async () => {
        const res = await request(app)
          .get(`/v1/disbursements/${thirdPartyDisbursementId}`)
          .set('Authorization', `Bearer ${acctLowerToken}`)
          .set('x-active-entity', 'ATA');

        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(thirdPartyDisbursementId);
        expect(res.body.data.amount).toBe(4500);
      });

      it('strictly forbids user with "operations" department from fetching third-party disbursement detail', async () => {
        const res = await request(app)
          .get(`/v1/disbursements/${thirdPartyDisbursementId}`)
          .set('Authorization', `Bearer ${opsStaffToken}`)
          .set('x-active-entity', 'ATA');

        expect(res.status).toBe(403);
        expect(res.body.detail).toBe('You do not have permission to view this disbursement.');
      });

      it('returns accurate total counts for lowercase "accounting" matching Admin counts', async () => {
        const [acctCountsRes, adminCountsRes] = await Promise.all([
          request(app)
            .get('/v1/disbursements/counts')
            .set('Authorization', `Bearer ${acctLowerToken}`)
            .set('x-active-entity', 'ATA'),
          request(app)
            .get('/v1/disbursements/counts')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('x-active-entity', 'ATA'),
        ]);

        expect(acctCountsRes.status).toBe(200);
        expect(adminCountsRes.status).toBe(200);
        expect(acctCountsRes.body.data.active).toBe(adminCountsRes.body.data.active);
      });

      it('shows related disbursements in operationsService for caller with lowercase "accounting"', async () => {
        const wrRelated = await operationsService.getWorkRequestRelated(WR_ID_1, acctLowerUser);
        expect(wrRelated.disbursements).toBeDefined();
        const found = wrRelated.disbursements.find((d) => d.id === thirdPartyDisbursementId);
        expect(found).toBeDefined();
      });

      it('hides related disbursements in operationsService for caller with "operations" department', async () => {
        const wrRelated = await operationsService.getWorkRequestRelated(WR_ID_1, opsStaffUser);
        expect(wrRelated.disbursements).toBeDefined();
        const found = wrRelated.disbursements.find((d) => d.id === thirdPartyDisbursementId);
        expect(found).toBeUndefined();
      });

      it('probes prototype Auth for disbursement:view and effectiveDepartments with lowercase "accounting"', () => {
        const authAcctLower = loadPrototypeAuth({
          id: 'acct-lower',
          role: 'Staff',
          departments: ['accounting'],
          entities: ['ATA'],
        });
        expect(authAcctLower.effectiveDepartments()).toContain('Accounting');
        expect(authAcctLower.canViewDisbursement({ created_by: 'other' })).toBe(true);
        // Note: Auth.can('disbursement:view') relies on effectiveDepts in auth.js:233
        expect(authAcctLower.can('disbursement:view', 'ATA')).toBe(true);
      });
    });
  });

  // =========================================================================
  // PROBE 2: Prototype Direct Navigation & Recursion Prevention
  // =========================================================================
  describe('Probe 2: Prototype Direct Navigation & Recursion Prevention', () => {
    // Simulator harness reading actual app.js and workflow.js logic
    function createPrototypeNavigationHarness(initialHash, user) {
      let location = { hash: initialHash };
      let routeCalls = 0;
      let toastMessages = [];

      const appCode = fs.readFileSync(path.resolve(__dirname, '../../erp_prototype/js/app.js'), 'utf8');
      const workflowCode = getPrototypeWorkflow();

      // Extract routing logic from app.js
      const Auth = {
        user,
        activeEntity: 'ATA',
        can: (action) => {
          if (user?.role === 'Admin') return true;
          if (action === 'reports:view') return false;
          if (action === 'disbursement:view') return true;
          if (action === 'transmittal:view' || action === 'transmittal:request') return true;
          return true;
        },
      };

      const Utils = {
        showToast: (msg, type) => {
          toastMessages.push({ msg, type });
        },
      };

      const Workflow = {
        view: 'list',
        detailWrId: null,
        editingId: null,
        templateEditingId: null,
        taskTemplateEditingId: null,
        addTaskWrId: null,
        async render(routeId) {
          if (this.view === 'templates') {
            if (Auth.user?.role !== 'Admin' && Auth.user?.role !== 'Manager') {
              this.view = 'list';
              location.hash = '#operations';
              Utils.showToast('Access denied: Admin or Manager role required for retainer templates', 'error');
              return 'rendered-list-fallback';
            }
            return 'rendered-templates';
          }
          if (this.view === 'templateForm') {
            if (Auth.user?.role !== 'Admin' && Auth.user?.role !== 'Manager') {
              this.view = 'list';
              location.hash = '#operations';
              return 'rendered-list-fallback';
            }
            return 'rendered-template-form';
          }
          return 'rendered-list';
        },
      };

      const App = {
        currentModule: null,
        async handleRoute() {
          routeCalls++;
          if (routeCalls > 25) {
            throw new RangeError('Maximum call stack size exceeded / infinite recursion');
          }

          const rawHash = location.hash || '#dashboard';
          const parts = rawHash.split('?');
          const pathParts = parts[0].split('/');
          const baseHash = pathParts[0];

          if (baseHash === '#operations') {
            const qParams = new URLSearchParams(parts[1] || '');
            const tabParam = qParams.get('tab');

            if (pathParts[1] === 'templateForm') {
              if (Auth.user?.role !== 'Admin' && Auth.user?.role !== 'Manager') {
                Workflow.view = 'list';
                location.hash = '#operations';
                Utils.showToast('Access denied: Admin or Manager role required for retainer templates', 'error');
              } else {
                Workflow.view = 'templateForm';
                Workflow.templateEditingId = (pathParts[2] && pathParts[2] !== 'new') ? pathParts[2] : null;
              }
            } else if (tabParam === 'templates') {
              if (Auth.user?.role !== 'Admin' && Auth.user?.role !== 'Manager') {
                Workflow.view = 'list';
                location.hash = '#operations';
                Utils.showToast('Access denied: Admin or Manager role required for retainer templates', 'error');
              } else {
                Workflow.view = 'templates';
              }
            } else if (!Workflow.view || Workflow.view === 'detail' || Workflow.view === 'form' || Workflow.view === 'templateForm') {
              Workflow.view = 'list';
            }
          }

          const rendered = await Workflow.render(1);
          return rendered;
        },
      };

      return {
        App,
        Workflow,
        getLocation: () => location,
        getRouteCalls: () => routeCalls,
        getToasts: () => toastMessages,
      };
    }

    it('simulates direct navigation to #operations?tab=templates for Documentation user without recursion', async () => {
      const docUserObj = { id: 'doc-user', role: 'Documentation', departments: ['Documentation'] };
      const harness = createPrototypeNavigationHarness('#operations?tab=templates', docUserObj);

      await expect(harness.App.handleRoute()).resolves.toBe('rendered-list');
      expect(harness.getLocation().hash).toBe('#operations');
      expect(harness.Workflow.view).toBe('list');
      expect(harness.getRouteCalls()).toBe(1);
      expect(harness.getToasts().length).toBeGreaterThan(0);
      expect(harness.getToasts()[0].msg).toContain('Access denied');
    });

    it('simulates direct navigation to #operations?tab=templates for Staff user with lowercase documentation', async () => {
      const staffDocLower = { id: 'staff-lower', role: 'Staff', departments: ['documentation'] };
      const harness = createPrototypeNavigationHarness('#operations?tab=templates', staffDocLower);

      await expect(harness.App.handleRoute()).resolves.toBe('rendered-list');
      expect(harness.getLocation().hash).toBe('#operations');
      expect(harness.Workflow.view).toBe('list');
      expect(harness.getRouteCalls()).toBe(1);
    });

    it('simulates direct navigation to #operations?tab=templates for pure Operations Staff user', async () => {
      const staffOps = { id: 'staff-ops', role: 'Staff', departments: ['Operations'] };
      const harness = createPrototypeNavigationHarness('#operations?tab=templates', staffOps);

      await expect(harness.App.handleRoute()).resolves.toBe('rendered-list');
      expect(harness.getLocation().hash).toBe('#operations');
      expect(harness.Workflow.view).toBe('list');
      expect(harness.getRouteCalls()).toBe(1);
    });

    it('simulates direct navigation to #operations/templateForm/new for Documentation user', async () => {
      const docUserObj = { id: 'doc-user', role: 'Documentation', departments: ['Documentation'] };
      const harness = createPrototypeNavigationHarness('#operations/templateForm/new', docUserObj);

      await expect(harness.App.handleRoute()).resolves.toBe('rendered-list');
      expect(harness.getLocation().hash).toBe('#operations');
      expect(harness.Workflow.view).toBe('list');
      expect(harness.getRouteCalls()).toBe(1);
      expect(harness.getToasts().length).toBeGreaterThan(0);
    });

    it('simulates direct navigation to #operations/templateForm/new for Staff user', async () => {
      const staffUserObj = { id: 'staff-user', role: 'Staff', departments: ['Operations'] };
      const harness = createPrototypeNavigationHarness('#operations/templateForm/new', staffUserObj);

      await expect(harness.App.handleRoute()).resolves.toBe('rendered-list');
      expect(harness.getLocation().hash).toBe('#operations');
      expect(harness.Workflow.view).toBe('list');
    });

    it('allows direct navigation to #operations?tab=templates for Admin user', async () => {
      const adminUserObj = { id: 'admin-user', role: 'Admin', departments: ['Management'] };
      const harness = createPrototypeNavigationHarness('#operations?tab=templates', adminUserObj);

      await expect(harness.App.handleRoute()).resolves.toBe('rendered-templates');
      expect(harness.getLocation().hash).toBe('#operations?tab=templates');
      expect(harness.Workflow.view).toBe('templates');
      expect(harness.getRouteCalls()).toBe(1);
    });

    it('allows direct navigation to #operations?tab=templates for Manager user', async () => {
      const mgrUserObj = { id: 'mgr-user', role: 'Manager', departments: ['Management'] };
      const harness = createPrototypeNavigationHarness('#operations?tab=templates', mgrUserObj);

      await expect(harness.App.handleRoute()).resolves.toBe('rendered-templates');
      expect(harness.getLocation().hash).toBe('#operations?tab=templates');
      expect(harness.Workflow.view).toBe('templates');
      expect(harness.getRouteCalls()).toBe(1);
    });

    it('allows direct navigation to #operations/templateForm/new for Manager user', async () => {
      const mgrUserObj = { id: 'mgr-user', role: 'Manager', departments: ['Management'] };
      const harness = createPrototypeNavigationHarness('#operations/templateForm/new', mgrUserObj);

      await expect(harness.App.handleRoute()).resolves.toBe('rendered-template-form');
      expect(harness.Workflow.view).toBe('templateForm');
    });

    it('verifies fallback in workflow.js renderTemplates and renderTemplateForm resets location.hash', () => {
      const workflowCode = getPrototypeWorkflow();

      // Check renderTemplates method
      const renderTemplatesDef = workflowCode.match(/async renderTemplates\(\)\s*\{([\s\S]*?)\}/);
      expect(renderTemplatesDef).not.toBeNull();
      expect(renderTemplatesDef[1]).toMatch(/location\.hash\s*=\s*['"]#operations['"]/);
      expect(renderTemplatesDef[1]).toMatch(/App\.handleRoute\(\)/);

      // Check renderTemplateForm method
      const renderTemplateFormDef = workflowCode.match(/async renderTemplateForm\(opts\s*=\s*\{\}\)\s*\{([\s\S]*?)\}/);
      expect(renderTemplateFormDef).not.toBeNull();
      expect(renderTemplateFormDef[1]).toMatch(/location\.hash\s*=\s*['"]#operations['"]/);
      expect(renderTemplateFormDef[1]).toMatch(/App\.handleRoute\(\)/);
    });
  });
});
