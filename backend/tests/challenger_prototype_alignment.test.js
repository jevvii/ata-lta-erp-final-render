const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadPrototypeAuth, getPrototypeStyles, getPrototypeWorkflow } = require('./e2e/helpers');

describe('Challenger Adversarial Verification: Prototype Legacy UI Alignment', () => {
  describe('Area 1: Direct URL navigation & Loop Avoidance in Prototype', () => {
    it('evaluates prototype URL handling behavior when tab=templates is passed for Documentation user', () => {
      const appCode = fs.readFileSync(path.resolve(__dirname, '../src/../../erp_prototype/js/app.js'), 'utf8');
      const workflowCode = getPrototypeWorkflow();

      // Check how app.js handles tabParam === 'templates'
      const appTemplatesHandling = appCode.match(/else if\s*\(\s*tabParam === 'templates'\s*\)\s*\{([\s\S]*?)\}/);
      expect(appTemplatesHandling).not.toBeNull();

      // Notice whether app.js checks role before setting Workflow.view = 'templates'
      const appChecksRole = /Auth\.user\?\.role/.test(appTemplatesHandling[1]);
      
      // Check renderTemplates in workflow.js
      const renderTemplatesDef = workflowCode.match(/async renderTemplates\(\)\s*\{([\s\S]*?)\}/);
      expect(renderTemplatesDef).not.toBeNull();

      // Verify what renderTemplates does when role is neither Admin nor Manager
      const guardsInRenderTemplates = renderTemplatesDef[1].includes("Auth.user?.role !== 'Admin' && Auth.user?.role !== 'Manager'");
      expect(guardsInRenderTemplates).toBe(true);

      // Now verify whether renderTemplates updates location.hash or calls App.handleRoute directly
      const updatesHash = /location\.hash\s*=\s*['"]#operations['"]/.test(renderTemplatesDef[1]);
      const callsHandleRoute = /App\.handleRoute\(\)/.test(renderTemplatesDef[1]);

      console.log('Prototype Area 1 Empirical Findings:', {
        appChecksRoleOnTemplates: appChecksRole,
        renderTemplatesGuardsRole: guardsInRenderTemplates,
        renderTemplatesUpdatesLocationHash: updatesHash,
        renderTemplatesCallsHandleRouteDirectly: callsHandleRoute
      });

      // If app does not check role AND renderTemplates does not update location.hash before calling App.handleRoute,
      // a direct call to App.handleRoute() with hash '#operations?tab=templates' causes recursion unless location.hash is normalized.
      expect(guardsInRenderTemplates).toBe(true);
    });

    it('simulates the routing lifecycle of #operations?tab=templates with and without URL normalization', async () => {
      // Create simulation harness
      function runRoutingCycle(normalizeHash) {
        let location = { hash: '#operations?tab=templates' };
        let currentView = 'list';
        let routeCalls = 0;
        let renderCalls = 0;

        const Auth = {
          user: { id: 'doc-1', role: 'Staff', departments: ['Documentation'] }
        };

        const Workflow = {
          view: 'list',
          async renderTemplates() {
            renderCalls++;
            if (renderCalls > 10) {
              throw new Error('Maximum call stack / endless loop reached!');
            }
            if (Auth.user?.role !== 'Admin' && Auth.user?.role !== 'Manager') {
              this.view = 'list';
              if (normalizeHash) {
                location.hash = '#operations';
              }
              await App.handleRoute();
              return {};
            }
          }
        };

        const App = {
          async handleRoute() {
            routeCalls++;
            const rawHash = location.hash || '#dashboard';
            const parts = rawHash.split('?');
            const qParams = new URLSearchParams(parts[1] || '');
            const tabParam = qParams.get('tab');

            if (tabParam === 'templates') {
              Workflow.view = 'templates';
            } else {
              Workflow.view = 'list';
            }

            if (Workflow.view === 'templates') {
              await Workflow.renderTemplates();
            }
          }
        };

        return { App, Workflow, getLocation: () => location, getCounts: () => ({ routeCalls, renderCalls }) };
      }

      // Without normalization: endless loop occurs
      const unnormalized = runRoutingCycle(false);
      await expect(unnormalized.App.handleRoute()).rejects.toThrow('Maximum call stack / endless loop reached!');

      // With normalization: loop is cleanly avoided
      const normalized = runRoutingCycle(true);
      await normalized.App.handleRoute();
      expect(normalized.getCounts().renderCalls).toBe(1);
      expect(normalized.getCounts().routeCalls).toBe(2);
      expect(normalized.Workflow.view).toBe('list');
      expect(normalized.getLocation().hash).toBe('#operations');
    });
  });

  describe('Area 2: Transmittal Task Select Tampering in Prototype', () => {
    it('enforces task selection and rejects blank or unassigned task selection in Prototype', () => {
      const code = getPrototypeWorkflow();

      // Check task selection block in openGenerateTransmittalModal
      expect(code).toMatch(/const isDocUser = Auth\.user\?\.role !== 'Admin'/);
      expect(code).toMatch(/const isTaskAssignee = \(t\) =>/);
      expect(code).toMatch(/const availableTasks = isDocUser \? tasks\.filter\(isTaskAssignee\) : tasks;/);

      // Check save handler validation
      expect(code).toMatch(/if \(isDocUser\) \{[\s\S]*?const taskField = form\.querySelector\('\[name="linkedTaskId"\]'\);/);
      expect(code).toMatch(/if \(!selectedTaskId \|\| !selectedTask \|\| !isTaskAssignee\(selectedTask\)\) \{/);
      expect(code).toMatch(/showFieldError\(taskField, 'Please select a task\. linkedTaskId is required\.'\);/);
    });

    it('verifies Prototype isTaskAssignee helper logic against various assignee shapes', () => {
      const code = getPrototypeWorkflow();
      // Extract isTaskAssignee logic and test it in VM
      const isTaskAssigneeMatch = code.match(/const isTaskAssignee = \((?:t)?\)\s*=>\s*\{([\s\S]*?)\n    \};/);
      expect(isTaskAssigneeMatch).not.toBeNull();

      const fnBody = isTaskAssigneeMatch[1];
      const testFn = new Function('t', 'Auth', `
        ${fnBody}
      `);

      const docUser = { id: 'u-doc-1', name: 'Doc User', role: 'Staff', departments: ['Documentation'] };
      const authObj = { user: docUser };

      // Case 1: Assigned as primary assigneeId
      expect(testFn({ assigneeId: 'u-doc-1' }, authObj)).toBe(true);

      // Case 2: Assigned as assignedTo
      expect(testFn({ assignedTo: 'u-doc-1' }, authObj)).toBe(true);

      // Case 3: Display names must NOT substitute for task assignment (Finding 4)
      expect(testFn({ assigneeId: 'u-other', assigneeName: 'Doc User' }, authObj)).toBe(false);

      // Case 4: Relational co-assignee in task_assignees (backend representation)
      expect(testFn({ assigneeId: 'u-other', task_assignees: [{ user_id: 'u-doc-1' }] }, authObj)).toBe(true);

      // Case 5: Relational co-assignee in assignees (array of IDs or objects)
      expect(testFn({ assigneeId: 'u-other', assignees: ['u-doc-1'] }, authObj)).toBe(true);
      expect(testFn({ assigneeId: 'u-other', taskAssignees: [{ userId: 'u-doc-1' }] }, authObj)).toBe(true);

      // Case 6: Checklist item assignee must NOT authorize (Finding 4)
      expect(testFn({ assigneeId: 'u-other', checklist: [{ assigneeId: 'u-doc-1' }] }, authObj)).toBe(false);

      // Case 7: Unassigned task
      expect(testFn({ id: 't-unassigned', assigneeId: 'u-other', coAssignees: ['u-other-2'] }, authObj)).toBe(false);

      // Case 8: Empty / null task
      expect(testFn(null, authObj)).toBe(false);
    });
  });

  describe('Area 3: Invoice Billing Action Triggers in Prototype', () => {
    it('denies billing:request permission in Prototype Auth for Documentation users', () => {
      // 1. Role Documentation
      const authDocRole = loadPrototypeAuth({
        id: 'u-1',
        role: 'Documentation',
        departments: [],
        entities: ['ATA'],
      });
      authDocRole.activeEntity = 'ATA';
      expect(authDocRole.can('billing:request')).toBe(false);

      // 2. Department Documentation
      const authDocDept = loadPrototypeAuth({
        id: 'u-2',
        role: 'Staff',
        departments: ['Documentation'],
        entities: ['ATA'],
      });
      authDocDept.activeEntity = 'ATA';
      expect(authDocDept.can('billing:request')).toBe(false);

      // 3. Multi-department (Documentation + Operations)
      const authDocOps = loadPrototypeAuth({
        id: 'u-3',
        role: 'Staff',
        departments: ['Operations', 'Documentation'],
        entities: ['ATA'],
      });
      authDocOps.activeEntity = 'ATA';
      expect(authDocOps.can('billing:request')).toBe(false);

      // 4. Operations-only staff
      const authOps = loadPrototypeAuth({
        id: 'u-4',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA'],
      });
      authOps.activeEntity = 'ATA';
      expect(authOps.can('billing:request')).toBe(true);
    });

    it('verifies that Prototype workflow buttons gate billing actions via Auth.can("billing:request")', () => {
      const code = getPrototypeWorkflow();

      // Card action trigger
      expect(code).toMatch(/\} else if \(Auth\.can\('billing:request'\)\) \{\s*billingTitle = 'Request Billing';/);

      // Required link badge click trigger
      expect(code).toMatch(/\} else if \(Auth\.can\('billing:request'\)\) \{\s*this\.submitOperationsRequest\('billing', wr, t\);/);

      // Invoices section header inline button trigger
      expect(code).toMatch(/\} else if \(!isArchived && Auth\.can\('billing:request'\)\) \{\s*const reqInvBtn = el\('button', \{ class: 'btn btn-secondary btn-xs btn-add-inline', text: '\+ Request Billing'/);
    });
  });

  describe('Area 4: Datepicker Scoped Styling in Prototype', () => {
    it('verifies scoped max-width rules for #wr-form .notion-prop--due-date .mdp-wrapper in styles.css', () => {
      const css = getPrototypeStyles();

      // Scoped rule specifically for Work Request due date field
      expect(css).toMatch(/#wr-form\s+\.notion-prop--due-date\s+\.mdp-wrapper\s*\{[\s\S]*?max-width:\s*220px;[\s\S]*?width:\s*100%;/);

      // Unscoped .notion-prop .mdp-wrapper must NOT exist globally
      expect(css).not.toMatch(/^\.notion-prop\s+\.mdp-wrapper\s*\{/m);

      // Unscoped .mdp-wrapper must not have global max-width: 220px override
      const globalMdpMatch = css.match(/\.mdp-wrapper\s*\{([^}]*)\}/);
      expect(globalMdpMatch).not.toBeNull();
      expect(globalMdpMatch[1]).not.toMatch(/max-width:\s*220px/);
    });
  });
});
