/**
 * Comprehensive Playwright QA Staging Audit Test
 * Target: http://localhost:8080
 * Environment: Isolated Staging (Local Backend http://127.0.0.1:3001)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:8080';
const DEFAULT_PASSWORD = 'Password@123';

const TEST_ACCOUNTS = {
  admin: { email: 'lorein@ata-lta.ph', name: 'Lorein Wong', role: 'Admin', depts: ['Management'] },
  manager: { email: 'love@ata-lta.ph', name: 'Lovelyn Rebong', role: 'Manager', depts: ['Management', 'Operations'] },
  operations: { email: 'ann@ata-lta.ph', name: 'Mary Ann Baraquiel', role: 'Operations', depts: ['Operations'] },
  accounting: { email: 'rachel@ata-lta.ph', name: 'Rachel Baradas', role: 'Accounting', depts: ['Accounting'] },
  docs: { email: 'twinkle@ata-lta.ph', name: 'Twinkle Marquez', role: 'Documentation', depts: ['Documentation'] }
};

const results = {
  authTests: {},
  rbacModuleInteractions: {},
  dashboardTaskNavigation: {},
  workRequestOrigins: {},
  adminAuditLogViewability: {},
  cachingAndDailyOperations: {},
  summaryFindings: []
};

async function loginUser(page, email, password = DEFAULT_PASSWORD) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Clear local storage and cookies to ensure clean login
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForSelector('#login-form', { state: 'visible', timeout: 8000 });

  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#login-form button[type="submit"]');

  // Wait for shell to be visible
  await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(800);
}

async function runAudit() {
  console.log('====================================================');
  console.log('STARTING AUTOMATED PLAYWRIGHT QA AUDIT ON STAGING');
  console.log(`Target URL: ${BASE_URL}`);
  console.log('====================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    // ----------------------------------------------------
    // TEST SUITE 1: User Roles & RBAC Authentication
    // ----------------------------------------------------
    console.log('>>> [1/5] Testing RBAC Authentication for all roles...');
    for (const [key, user] of Object.entries(TEST_ACCOUNTS)) {
      try {
        await loginUser(page, user.email);
        const nameText = await page.textContent('#user-name');
        const entitySwitcher = await page.$('#entity-switcher');
        const entityOptions = entitySwitcher ? await entitySwitcher.innerText() : '';
        const navLinks = await page.$$eval('nav ul li a', links =>
          links.map(a => ({
            module: a.getAttribute('data-module'),
            text: a.querySelector('.nav-link-text')?.textContent?.trim(),
            visible: a.offsetParent !== null
          }))
        );

        results.authTests[key] = {
          email: user.email,
          role: user.role,
          loggedInAs: nameText?.trim(),
          success: true,
          navLinks,
          entityOptions: entityOptions.split('\n').map(s => s.trim()).filter(Boolean)
        };
        console.log(`  ✓ ${user.role} (${user.email}) logged in successfully as "${nameText?.trim()}"`);
      } catch (err) {
        results.authTests[key] = {
          email: user.email,
          role: user.role,
          success: false,
          error: err.message
        };
        console.log(`  ✗ ${user.role} (${user.email}) failed login: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST SUITE 2: RBAC Module Creation & Interactions
    // ----------------------------------------------------
    console.log('\n>>> [2/5] Testing RBAC Module Create Actions & UI Controls...');

    // 2A: Admin Create Actions
    await loginUser(page, TEST_ACCOUNTS.admin.email);
    const adminInteractions = {};

    // Clients
    await page.goto(`${BASE_URL}/#clients`);
    await page.waitForTimeout(1000);
    const adminAddClientBtn = await page.$('button:has-text("Add Client"), button:has-text("New Client"), .btn:has-text("Client")');
    adminInteractions.canCreateClient = !!adminAddClientBtn && await adminAddClientBtn.isVisible();

    // Operations / Work Request
    await page.goto(`${BASE_URL}/#operations`);
    await page.waitForTimeout(1000);
    const adminAddWrBtn = await page.$('button:has-text("Create Work Request"), button:has-text("New Work Request"), #new-work-request-btn');
    adminInteractions.canCreateWorkRequest = !!adminAddWrBtn && await adminAddWrBtn.isVisible();

    // Billing / Invoices
    await page.goto(`${BASE_URL}/#billing`);
    await page.waitForTimeout(1500);
    const adminAddInvBtn = await page.$('button:has-text("New Billing"), button:has-text("Add Billing"), button:has-text("New Invoice")');
    adminInteractions.canCreateInvoice = !!adminAddInvBtn && await adminAddInvBtn.isVisible();

    // Disbursement
    await page.goto(`${BASE_URL}/#disbursement`);
    await page.waitForTimeout(1500);
    const adminAddDisbBtn = await page.$('button:has-text("New Disbursement"), button:has-text("File Expense")');
    adminInteractions.canCreateDisbursement = !!adminAddDisbBtn && await adminAddDisbBtn.isVisible();

    // Transmittal
    await page.goto(`${BASE_URL}/#transmittal`);
    await page.waitForTimeout(1500);
    const adminAddTxBtn = await page.$('button:has-text("New Transmittal"), button:has-text("Create Transmittal")');
    adminInteractions.canCreateTransmittal = !!adminAddTxBtn && await adminAddTxBtn.isVisible();

    // Admin Users
    await page.goto(`${BASE_URL}/#admin`);
    await page.waitForTimeout(1500);
    const adminAddUserBtn = await page.$('button:has-text("+ Add User"), button:has-text("Add User")');
    adminInteractions.canCreateUser = !!adminAddUserBtn && await adminAddUserBtn.isVisible();

    results.rbacModuleInteractions.admin = adminInteractions;
    console.log('  Admin create capabilities:', adminInteractions);

    // 2B: Operations Staff Create Actions
    await loginUser(page, TEST_ACCOUNTS.operations.email);
    const opsInteractions = {};

    await page.goto(`${BASE_URL}/#clients`);
    await page.waitForTimeout(1000);
    const opsAddClientBtn = await page.$('button:has-text("Add Client"), button:has-text("New Client")');
    opsInteractions.canCreateClient = !!opsAddClientBtn && await opsAddClientBtn.isVisible();

    await page.goto(`${BASE_URL}/#operations`);
    await page.waitForTimeout(1000);
    const opsAddWrBtn = await page.$('button:has-text("Create Work Request"), button:has-text("New Work Request")');
    opsInteractions.canCreateWorkRequestDirectly = !!opsAddWrBtn && await opsAddWrBtn.isVisible();

    // In Operations, check if task add exists
    const opsAddTaskBtn = await page.$('button:has-text("Add Task"), button:has-text("New Task")');
    opsInteractions.canAddTask = !!opsAddTaskBtn && await opsAddTaskBtn.isVisible();

    await page.goto(`${BASE_URL}/#billing`);
    await page.waitForTimeout(1000);
    const opsAddInvBtn = await page.$('button:has-text("New Invoice"), button:has-text("Create Invoice")');
    const opsReqInvBtn = await page.$('button:has-text("Request Invoice"), button:has-text("Request Billing")');
    opsInteractions.canCreateInvoiceDirectly = !!opsAddInvBtn && await opsAddInvBtn.isVisible();
    opsInteractions.canRequestInvoice = !!opsReqInvBtn && await opsReqInvBtn.isVisible();

    await page.goto(`${BASE_URL}/#disbursement`);
    await page.waitForTimeout(1000);
    const opsAddDisbBtn = await page.$('button:has-text("New Disbursement")');
    const opsReqDisbBtn = await page.$('button:has-text("Request Disbursement")');
    opsInteractions.canCreateDisbursementDirectly = !!opsAddDisbBtn && await opsAddDisbBtn.isVisible();
    opsInteractions.canRequestDisbursement = !!opsReqDisbBtn && await opsReqDisbBtn.isVisible();

    results.rbacModuleInteractions.operations = opsInteractions;
    console.log('  Operations staff create capabilities:', opsInteractions);

    // 2C: Accounting Staff Create Actions
    await loginUser(page, TEST_ACCOUNTS.accounting.email);
    const accInteractions = {};

    await page.goto(`${BASE_URL}/#billing`);
    await page.waitForTimeout(1500);
    const accAddInvBtn = await page.$('button:has-text("New Billing"), button:has-text("Add Billing"), button:has-text("New Invoice")');
    accInteractions.canCreateInvoice = !!accAddInvBtn && await accAddInvBtn.isVisible();

    await page.goto(`${BASE_URL}/#disbursement`);
    await page.waitForTimeout(1500);
    const accAddDisbBtn = await page.$('button:has-text("New Disbursement"), button:has-text("File Expense")');
    accInteractions.canCreateDisbursement = !!accAddDisbBtn && await accAddDisbBtn.isVisible();

    results.rbacModuleInteractions.accounting = accInteractions;
    console.log('  Accounting staff create capabilities:', accInteractions);

    // ----------------------------------------------------
    // TEST SUITE 3: Dashboard Task Navigation & Highlight
    // ----------------------------------------------------
    console.log('\n>>> [3/5] Testing Dashboard Task Navigation & Highlighting on Non-Admin User...');
    await loginUser(page, TEST_ACCOUNTS.operations.email);
    await page.goto(`${BASE_URL}/#dashboard`);
    await page.waitForTimeout(1500);

    const dashboardNavResults = {
      userRole: 'Operations Staff',
      dashboardView: 'Entity Scoped',
      eodButtonTested: false,
      eodTargetUrl: null,
      codeAnalysis: {}
    };

    // Check EOD Reminder
    const eodReminderBtn = await page.$('button:has-text("Go to Tasks")');
    if (eodReminderBtn && await eodReminderBtn.isVisible()) {
      dashboardNavResults.eodButtonTested = true;
      await eodReminderBtn.click();
      await page.waitForTimeout(800);
      dashboardNavResults.eodTargetUrl = page.url();
    }

    // Inspect codebase behavior in page context
    const navCodeAudit = await page.evaluate(() => {
      const dashboardRouteCode = typeof Dashboard !== 'undefined' ? Dashboard._routeToItem.toString() : '';
      const routesToWrOnly = dashboardRouteCode.includes('#operations/detail/\' + item.id') && !dashboardRouteCode.includes('taskId');
      
      const renderDetailCode = typeof Workflow !== 'undefined' ? Workflow.renderDetail.toString() : '';
      const readsTaskIdParam = renderDetailCode.includes('taskId') || renderDetailCode.includes('highlight');
      const hasTaskHighlightClass = renderDetailCode.includes('task-highlight') || renderDetailCode.includes('task-row--highlight');

      return {
        routesToWrOnly,
        readsTaskIdParam,
        hasTaskHighlightClass
      };
    });

    dashboardNavResults.codeAnalysis = navCodeAudit;
    results.dashboardTaskNavigation = dashboardNavResults;
    console.log('  Dashboard Task Navigation Findings:', dashboardNavResults);

    // ----------------------------------------------------
    // TEST SUITE 4: Work Request Origins for Requested/Pending Items
    // ----------------------------------------------------
    console.log('\n>>> [4/5] Testing Work Request Origins in Pending Items & Requests...');

    // Test in Admin Pending Approvals view
    await loginUser(page, TEST_ACCOUNTS.admin.email);
    await page.goto(`${BASE_URL}/#admin`);
    await page.waitForTimeout(1500);

    const wrOriginInspection = await page.evaluate(() => {
      const usersCode = typeof Users !== 'undefined' ? Users.renderPendingDetail?.toString() : '';
      const opsReqShowsWr = usersCode ? (usersCode.includes('pc.isOperationsRequest') && usersCode.includes('Work request')) : false;
      const disbShowsWr = usersCode ? (usersCode.includes("pc.table === 'disbursements'") && usersCode.includes('Work request')) : false;

      const renderDetailCode = typeof Workflow !== 'undefined' ? Workflow.renderDetail?.toString() : '';
      const wrDetailFetchesOpsReqs = renderDetailCode ? renderDetailCode.includes('operationsRequests.list') : false;
      const wrDetailRendersPendingOpsSection = renderDetailCode ? (renderDetailCode.includes('Pending Operations Requests') || renderDetailCode.includes('pending-requests')) : false;

      return {
        pendingApprovalModal_OpsRequestShowsWrOrigin: opsReqShowsWr,
        pendingApprovalModal_DisbursementShowsWrOrigin: disbShowsWr,
        wrDetailPage_FetchesOpsRequests: wrDetailFetchesOpsReqs,
        wrDetailPage_RendersPendingOpsSection: wrDetailRendersPendingOpsSection
      };
    });

    results.workRequestOrigins = wrOriginInspection;
    console.log('  Work Request Origins Findings:', results.workRequestOrigins);

    // ----------------------------------------------------
    // TEST SUITE 5: Admin Audit Log Item Viewability
    // ----------------------------------------------------
    console.log('\n>>> [5/5] Testing Admin Audit Log Item Viewability...');
    await page.goto(`${BASE_URL}/#admin`);
    await page.waitForTimeout(1000);

    // Click Audit Log tab
    const auditTabBtn = await page.$('button:has-text("Audit Log"), .tab-item:has-text("Audit")');
    if (auditTabBtn) {
      await auditTabBtn.click();
      await page.waitForTimeout(2000);
    }

    const auditLogInspection = await page.evaluate(() => {
      const rows = document.querySelectorAll('.jira-backlog-row');
      let rowsWithLinks = 0;
      let rowsWithClickHandlers = 0;

      rows.forEach(row => {
        if (row.onclick) rowsWithClickHandlers++;
        if (row.querySelectorAll('a[href], button').length > 0) rowsWithLinks++;
      });

      const refreshAuditCode = typeof Users !== 'undefined' ? Users.refreshAuditLog?.toString() : '';
      const hasRowActions = refreshAuditCode.includes('rowActions:');
      const hasOnRowClick = refreshAuditCode.includes('onRowClick:');

      return {
        totalRowsRendered: rows.length,
        rowsWithClickHandlers,
        rowsWithLinks,
        hasRowActionsInCode: hasRowActions,
        hasOnRowClickInCode: hasOnRowClick,
        isAuditItemClickableViewable: rowsWithClickHandlers > 0 || rowsWithLinks > 0 || hasRowActions
      };
    });

    results.adminAuditLogViewability = auditLogInspection;
    console.log('  Admin Audit Log Viewability Findings:', auditLogInspection);

  } catch (err) {
    console.error('Audit execution error:', err);
  } finally {
    await browser.close();
  }

  // Save audit results to JSON file
  fs.writeFileSync(
    path.join(__dirname, 'qa-audit-test-results.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );
  console.log('\n====================================================');
  console.log('QA AUDIT TEST COMPLETED — RESULTS SAVED TO JSON');
  console.log('====================================================');
}

runAudit();
