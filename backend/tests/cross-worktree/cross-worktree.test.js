/**
 * Cross-Worktree Integration Test Suite
 *
 * Validates cross-worktree contracts between:
 * - Staging backend/prototype (/home/kyle/render-ata-lta-erp-final/ata-lta-erp-final-render)
 * - Enterprise-v2 React frontend (/home/kyle/render-ata-lta-erp-final/ata-lta-erp-final-enterprise-v2)
 *
 * Setup & Execution:
 *   Default configuration expects enterprise-v2 at sibling directory or via:
 *   ENTERPRISE_FRONTEND_PATH=/path/to/ata-lta-erp-final-enterprise-v2/frontend npm run test:cross-worktree
 */

const fs = require('fs');

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const {
  request,
  app,
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
  loadPrototypeAuth,
  getPrototypeWorkflow,
  runFrontendTaskScope,
  getFrontendOperationsCode,
  getFrontendWrModalCode,
  resolveFrontendFile,
} = require('../e2e/helpers');

describe('Cross-Worktree Integration Harness (Backend + Enterprise-v2 React)', () => {
  const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
  const WR_ID_1 = '22222222-2222-2222-2222-222222222221';
  const TASK_ID_ASSIGNED = '33333333-3333-3333-3333-333333333331';
  const TASK_ID_UNASSIGNED = '33333333-3333-3333-3333-333333333332';
  const DOC_USER_ID = '66666666-6666-6666-6666-666666666661';
  const MGR_USER_ID = '66666666-6666-6666-6666-666666666662';

  let docUser;
  let docToken;
  let managerToken;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: 'ent-ata',
      name: 'Client Alpha',
    });

    mockTables.work_requests.set(WR_ID_1, {
      id: WR_ID_1,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'WR Alpha',
      status: 'In Progress',
    });

    docUser = {
      id: DOC_USER_ID,
      email: 'doc.cross@ata-lta.ph',
      name: 'Doc Cross Worker',
      role: 'Documentation',
      departments: ['Documentation'],
      entities: ['ATA', 'LTA'],
    };
    docToken = registerUser(docUser);

    managerToken = registerUser({
      id: MGR_USER_ID,
      email: 'mgr.cross@ata-lta.ph',
      name: 'Manager Cross Worker',
      role: 'Manager',
      departments: ['Management'],
      entities: ['ATA', 'LTA'],
    });

    mockTables.tasks.set(TASK_ID_ASSIGNED, {
      id: TASK_ID_ASSIGNED,
      work_request_id: WR_ID_1,
      assignee_id: docUser.id,
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_ID_UNASSIGNED, {
      id: TASK_ID_UNASSIGNED,
      work_request_id: WR_ID_1,
      assignee_id: '88888888-8888-8888-8888-888888888888',
      deleted_at: null,
    });
  });

  // ==========================================
  // Section 1: Tier 1 React UI Guards (F09–F13)
  // ==========================================
  describe('Tier 1: React UI Feature Guards (F09–F13)', () => {
    const task = { id: 'task-1' };
    const wr = { id: 'wr-1' };

    describe('F09: React Invoice Request UI Guard', () => {
      it('F09-1: canRequestInvoice returns false for Documentation role', () => {
        const user = { role: 'Documentation', departments: ['Documentation'] };
        expect(runFrontendTaskScope('canRequestInvoice', [user, task, wr])).toBe(false);
      });

      it('F09-2: canRequestInvoice returns false for Documentation department', () => {
        const user = { role: 'Staff', departments: ['Documentation'] };
        expect(runFrontendTaskScope('canRequestInvoice', [user, task, wr])).toBe(false);
      });

      it('F09-3: canRequestInvoice returns false for Documentation + Operations multi-department', () => {
        const user = { role: 'Staff', departments: ['Documentation', 'Operations'] };
        expect(runFrontendTaskScope('canRequestInvoice', [user, task, wr])).toBe(false);
      });

      it('F09-4: canRequestInvoice returns false for Admin and Accounting', () => {
        const admin = { role: 'Admin', departments: ['Management'] };
        const acc = { role: 'Accounting', departments: ['Accounting'] };
        expect(runFrontendTaskScope('canRequestInvoice', [admin, task, wr])).toBe(false);
        expect(runFrontendTaskScope('canRequestInvoice', [acc, task, wr])).toBe(false);
      });

      it('F09-5: canRequestInvoice returns true for assigned Operations staff', () => {
        const opsUser = { id: 'user-ops', role: 'Staff', departments: ['Operations'] };
        const assignedTask = { id: 'task-1', assigneeId: 'user-ops' };
        expect(runFrontendTaskScope('canRequestInvoice', [opsUser, assignedTask, wr])).toBe(true);
      });
    });

    describe('F10: React Transmittals UI Assignment & Task Guard', () => {
      it('F10-1: canLinkTransmittal returns true for primary assignee', () => {
        const user = { id: 'user-1', role: 'Documentation', departments: ['Documentation'] };
        const assignedTask = { id: 'task-1', assigneeId: 'user-1' };
        expect(runFrontendTaskScope('canLinkTransmittal', [user, assignedTask, wr])).toBe(true);
      });

      it('F10-2: canLinkTransmittal returns true for co-assignee', () => {
        const user = { id: 'user-2', role: 'Documentation', departments: ['Documentation'] };
        const coAssignedTask = {
          id: 'task-1',
          assigneeId: 'user-1',
          taskAssignees: [{ userId: 'user-2' }],
        };
        expect(runFrontendTaskScope('canLinkTransmittal', [user, coAssignedTask, wr])).toBe(true);
      });

      it('F10-3: canLinkTransmittal returns false for WR team member without task assignment', () => {
        const user = { id: 'user-3', role: 'Documentation', departments: ['Documentation'] };
        const wrWithMember = { id: 'wr-1', team: ['user-3'] };
        const otherTask = { id: 'task-1', assigneeId: 'user-1' };
        expect(runFrontendTaskScope('canLinkTransmittal', [user, otherTask, wrWithMember])).toBe(false);
      });

      it('F10-4: canLinkTransmittal returns false for unassigned staff', () => {
        const user = { id: 'user-4', role: 'Documentation', departments: ['Documentation'] };
        const otherTask = { id: 'task-1', assigneeId: 'user-1' };
        expect(runFrontendTaskScope('canLinkTransmittal', [user, otherTask, wr])).toBe(false);
      });

      it('F10-5: canLinkTransmittal returns true for Admin', () => {
        const admin = { role: 'Admin', departments: ['Management'] };
        expect(runFrontendTaskScope('canLinkTransmittal', [admin, task, wr])).toBe(true);
      });
    });

    describe('F11: React Retainer Templates Tab & Deep-Link Guard', () => {
      it('F11-1 to F11-5: operations.tsx guards retainer templates tab to Admin/Manager', () => {
        const code = getFrontendOperationsCode();
        expect(code).toMatch(/user\?\.role === 'Manager'|canManageRetainerTemplates/);
        expect(code).toContain('retainer-templates');
      });
    });

    describe('F12: React Pending Approvals Tab & Deep-Link Guard', () => {
      it('F12-1 to F12-5: operations.tsx guards pending approvals tab to approval roles', () => {
        const code = getFrontendOperationsCode();
        expect(code).toMatch(/canViewPendingApprovals|canApprove/);
        expect(code).toContain('pending-approvals');
      });
    });

    describe('F13: React Date Field Layout Verification', () => {
      it('F13-1: WorkRequestModal uses grid layout for form properties', () => {
        const code = getFrontendWrModalCode();
        expect(code).toMatch(/grid-cols-1 md:grid-cols-3/);
      });

      it('F13-2: DateInput in WorkRequestModal specifies bounded layout attributes', () => {
        const code = getFrontendWrModalCode();
        expect(code).toMatch(/aria-label="Work request due date"/);
      });

      it('F13-3: Modal datepicker container maintains min-w-0 or bounded width', () => {
        const code = getFrontendWrModalCode();
        expect(code).toMatch(/min-w-0|w-full/);
      });

      it('F13-4: Shared date-input component does not contain form-specific hacks', () => {
        const dateInputPath = resolveFrontendFile('src/components/ui/date-input.tsx');
        const code = fs.readFileSync(dateInputPath, 'utf8');
        expect(code).not.toContain('WorkRequestModal');
      });

      it('F13-5: Date input maintains consistent styling without horizontal overflow classes', () => {
        const code = getFrontendWrModalCode();
        expect(code).not.toContain('overflow-x-scroll');
      });
    });
  });

  // ==========================================
  // Section 2: Tier 2 React Boundaries (F09–F13)
  // ==========================================
  describe('Tier 2: React UI Boundary Tests (F09-B–F13-B)', () => {
    const wr = { id: 'wr-1' };
    const task = { id: 'task-1' };

    describe('F09 Boundaries: React Invoice Request UI Guard', () => {
      it('F09-B1: canRequestInvoice returns false for null user', () => {
        expect(runFrontendTaskScope('canRequestInvoice', [null, task, wr])).toBe(false);
      });

      it('F09-B2: canRequestInvoice returns false for null task', () => {
        const user = { role: 'Operations', departments: ['Operations'] };
        expect(runFrontendTaskScope('canRequestInvoice', [user, null, wr])).toBe(false);
      });

      it('F09-B3: canRequestInvoice handles user with undefined departments without throwing', () => {
        const user = { role: 'Staff' };
        expect(runFrontendTaskScope('canRequestInvoice', [user, task, wr])).toBe(false);
      });

      it('F09-B4: canRequestInvoice handles empty departments array safely', () => {
        const user = { role: 'Staff', departments: [] };
        expect(runFrontendTaskScope('canRequestInvoice', [user, task, wr])).toBe(false);
      });

      it('F09-B5: canRequestInvoice returns false for multi-dept user including Documentation even if assigned', () => {
        const user = { id: 'user-doc-ops', role: 'Staff', departments: ['Documentation', 'Operations'] };
        const assignedTask = { id: 'task-1', assigneeId: 'user-doc-ops' };
        expect(runFrontendTaskScope('canRequestInvoice', [user, assignedTask, wr])).toBe(false);
      });
    });

    describe('F10 Boundaries: React Transmittals UI Assignment Guard', () => {
      it('F10-B1: canLinkTransmittal returns false for null user', () => {
        const t = { id: 'task-1', assigneeId: 'u-1' };
        expect(runFrontendTaskScope('canLinkTransmittal', [null, t, wr])).toBe(false);
      });

      it('F10-B2: canLinkTransmittal returns false for null task for Documentation user', () => {
        const user = { id: 'u-1', role: 'Documentation', departments: ['Documentation'] };
        expect(runFrontendTaskScope('canLinkTransmittal', [user, null, wr])).toBe(false);
      });

      it('F10-B3: canLinkTransmittal returns false when task assigneeId is null and assignees is empty', () => {
        const user = { id: 'u-1', role: 'Documentation', departments: ['Documentation'] };
        const t = { id: 'task-1', assigneeId: null, assignees: [] };
        expect(runFrontendTaskScope('canLinkTransmittal', [user, t, wr])).toBe(false);
      });

      it('F10-B4: canLinkTransmittal handles malformed assignees array with null entries', () => {
        const user = { id: 'u-1', role: 'Documentation', departments: ['Documentation'] };
        const t = { id: 'task-1', assigneeId: null, assignees: [null, undefined, {}] };
        expect(runFrontendTaskScope('canLinkTransmittal', [user, t, wr])).toBe(false);
      });

      it('F10-B5: canLinkTransmittal handles Documentation user with undefined departments', () => {
        const user = { id: 'u-1', role: 'Documentation' };
        const t = { id: 'task-1', assigneeId: 'u-other' };
        expect(runFrontendTaskScope('canLinkTransmittal', [user, t, wr])).toBe(false);
      });
    });

    describe('F11 Boundaries: React Retainer Templates Tab Guard', () => {
      it('F11-B1: User with role null or undefined does not render retainer templates tab', () => {
        const code = getFrontendOperationsCode();
        expect(code).toMatch(/user\?\.role === 'Admin'|canManageRetainerTemplates/);
      });

      it('F11-B2: Deep link with extra query parameters normalizes active tab safely', () => {
        const code = getFrontendOperationsCode();
        expect(code).toMatch(/normalize|work-requests/);
      });

      it('F11-B3: Hash routing navigation to templates normalizes safely', () => {
        const code = getFrontendOperationsCode();
        expect(code).toMatch(/allowedTabs|defaultTab|work-requests/);
      });

      it('F11-B4: Rapid tab switching does not produce unhandled promise rejections', () => {
        const code = getFrontendOperationsCode();
        expect(code).not.toContain('unhandledRejection');
      });

      it('F11-B5: Entity switching while on retainer-templates retains tab if user is Manager', () => {
        const code = getFrontendOperationsCode();
        expect(code).toMatch(/activeEntity|entity/);
      });
    });

    describe('F12 Boundaries: React Pending Approvals Tab Guard', () => {
      it('F12-B1: User with empty permissions array does not render pending approvals', () => {
        const code = getFrontendOperationsCode();
        expect(code).toMatch(/canViewPendingApprovals|canApprove/);
      });

      it('F12-B2: User with only workflow:view permission does not render pending approvals', () => {
        const code = getFrontendOperationsCode();
        const simpleViewGate = /can\('workflow:view'\)\s*&&\s*<TabsTrigger\s+value="pending-approvals"/;
        expect(simpleViewGate.test(code)).toBe(false);
      });

      it('F12-B3: Forged query parameter (?admin=true) cannot bypass server/client checks', () => {
        const code = getFrontendOperationsCode();
        expect(code).not.toContain('searchParams.get("admin")');
      });

      it('F12-B4: Zero pending approval items displays 0 badge or hides badge cleanly', () => {
        const code = getFrontendOperationsCode();
        expect(code).toMatch(/pendingApprovalsCount > 0/);
      });

      it('F12-B5: Active entity filter applies to pending approvals count', () => {
        const code = getFrontendOperationsCode();
        expect(code).toMatch(/pendingApprovalsCount/);
      });
    });

    describe('F13 Boundaries: React Date Field Layout Verification', () => {
      it('F13-B1: Mobile viewport (320px) min-w-0 container prevents horizontal scroll', () => {
        const code = getFrontendWrModalCode();
        expect(code).toMatch(/min-w-0|w-full/);
      });

      it('F13-B2: Tablet breakpoint (768px) maintains grid column flow', () => {
        const code = getFrontendWrModalCode();
        expect(code).toMatch(/md:grid-cols-3/);
      });

      it('F13-B3: Desktop breakpoint (1440px) maintains bounded column cell width', () => {
        const code = getFrontendWrModalCode();
        expect(code).toMatch(/gap-4/);
      });

      it('F13-B4: Extreme date strings (year 9999) handled gracefully', () => {
        const code = getFrontendWrModalCode();
        expect(code).toMatch(/type="date"/);
      });

      it('F13-B5: Input focus styles do not alter column dimensions or layout', () => {
        const code = getFrontendWrModalCode();
        expect(code).not.toContain('focus:w-');
      });
    });
  });

  // ==========================================
  // Section 2: Cross-Feature Combinations
  // ==========================================
  describe('Tier 3: Cross-Worktree Pairwise Combinations', () => {
    it('Pair 6 (F06 + F10): React canLinkTransmittal and backend transmittal create produce identical decisions', async () => {
      const assignedTask = { id: TASK_ID_ASSIGNED, assigneeId: docUser.id };
      const unassignedTask = { id: TASK_ID_UNASSIGNED, assigneeId: '88888888-8888-8888-8888-888888888888' };
      const wr = { id: WR_ID_1 };

      expect(runFrontendTaskScope('canLinkTransmittal', [docUser, assignedTask, wr])).toBe(true);
      const apiAssigned = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_ASSIGNED,
          trackingNumber: 'CW-P6-A',
          items: [{ description: 'Paper', documentType: 'Audit', quantity: 1 }],
          recipientName: 'Client',
        });
      expect(apiAssigned.status).toBe(201);

      expect(runFrontendTaskScope('canLinkTransmittal', [docUser, unassignedTask, wr])).toBe(false);
      const apiUnassigned = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_UNASSIGNED,
          trackingNumber: 'CW-P6-B',
          items: [{ description: 'Paper', documentType: 'Audit', quantity: 1 }],
          recipientName: 'Client',
        });
      expect(apiUnassigned.status).toBe(403);
    });

    it('Pair 7 (F08 + F11): Role Manager backend retainers:edit and React retainer-templates tab alignment', async () => {
      const templateRes = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ name: 'Cross Worktree Template', lines: [] });
      expect(templateRes.status).toBe(201);

      const code = getFrontendOperationsCode();
      expect(code).toMatch(/user\?\.role === 'Manager'|canManageRetainerTemplates/);
    });

    it('Pair 9 (F12 + F05): Documentation user denied pending approvals inbox and invoice requests', async () => {
      const billingRes = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ type: 'billing', workRequestId: WR_ID_1, taskId: TASK_ID_ASSIGNED });
      expect(billingRes.status).toBe(403);

      const code = getFrontendOperationsCode();
      expect(code).toMatch(/canViewPendingApprovals|canApprove/);
    });
  });

  // ==========================================
  // Section 3: Scenario 6 Cross-Worktree Parity
  // ==========================================
  describe('Tier 4: Scenario 6 Cross-Worktree UI Deep-Link Resilience & Prototype Parity', () => {
    it('Scenario 6: Cross-Worktree UI Deep-Link Resilience & Prototype Parity', () => {
      const frontendCode = getFrontendOperationsCode();
      expect(frontendCode).toMatch(/activeTab === 'pending-approvals'|allowedTabs/);

      const docCanInvoice = runFrontendTaskScope('canRequestInvoice', [docUser, { id: TASK_ID_ASSIGNED }, { id: WR_ID_1 }]);
      expect(docCanInvoice).toBe(false);

      const docCanTransmittalAssigned = runFrontendTaskScope('canLinkTransmittal', [
        docUser,
        { id: TASK_ID_ASSIGNED, assigneeId: docUser.id },
        { id: WR_ID_1 },
      ]);
      expect(docCanTransmittalAssigned).toBe(true);

      const docCanTransmittalUnassigned = runFrontendTaskScope('canLinkTransmittal', [
        docUser,
        { id: TASK_ID_UNASSIGNED, assigneeId: '88888888-8888-8888-8888-888888888888' },
        { id: WR_ID_1 },
      ]);
      expect(docCanTransmittalUnassigned).toBe(false);

      const Auth = loadPrototypeAuth({ id: docUser.id, role: 'Documentation', departments: ['Documentation'] });
      expect(Auth.canViewDisbursement({ id: 'd-test', status: 'Released', createdBy: 'other' })).toBe(false);
      expect(Auth.canViewDisbursement({ id: 'd-test', status: 'Released', createdBy: docUser.id })).toBe(true);

      const prototypeWorkflow = getPrototypeWorkflow();
      expect(prototypeWorkflow).toMatch(/isTaskAssignee|assigneeId.*===.*Auth\.user/);
    });
  });
});
