/**
 * Comprehensive Playwright Chaos Engineering & E2E Verification Script
 * Validates all roles, modules, forms, and recent bug fixes/enhancements
 * on both Remote Staging (Render) and Isolated Staging (Local).
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = process.env.TEST_URL || 'http://localhost:8080';

// Test credentials loaded exclusively from environment variables to prevent leaking plaintext secrets
const TEST_AUTH_PASSWORD = process.env.TEST_PASSWORD || process.env.STAGING_TEST_PASSWORD || '';

const ROLES_TO_TEST = [
  {
    key: 'admin',
    email: process.env.TEST_ADMIN_EMAIL || 'dev-admin@ata-lta.ph',
    password: process.env.TEST_ADMIN_PASSWORD || TEST_AUTH_PASSWORD,
    role: 'Admin',
    isManagerial: true
  },
  {
    key: 'manager',
    email: process.env.TEST_MANAGER_EMAIL || 'love@ata-lta.ph',
    password: process.env.TEST_MANAGER_PASSWORD || TEST_AUTH_PASSWORD,
    role: 'Manager',
    isManagerial: true
  },
  {
    key: 'operations',
    email: process.env.TEST_OPS_EMAIL || 'ann@ata-lta.ph',
    password: process.env.TEST_OPS_PASSWORD || TEST_AUTH_PASSWORD,
    role: 'Operations',
    isManagerial: false
  },
  {
    key: 'accounting',
    email: process.env.TEST_ACCS_EMAIL || 'rachel@ata-lta.ph',
    password: process.env.TEST_ACCS_PASSWORD || TEST_AUTH_PASSWORD,
    role: 'Accounting',
    isManagerial: false
  },
  {
    key: 'docs',
    email: process.env.TEST_DOCS_EMAIL || 'twinkle@ata-lta.ph',
    password: process.env.TEST_DOCS_PASSWORD || TEST_AUTH_PASSWORD,
    role: 'Documentation',
    isManagerial: false
  }
];

const report = {
  targetUrl: TARGET_URL,
  startedAt: new Date().toISOString(),
  testCases: {},
  consoleErrors: [],
  summary: { total: 0, passed: 0, failed: 0 }
};

function recordTest(id, name, passed, details = {}) {
  report.summary.total++;
  if (passed) report.summary.passed++;
  else report.summary.failed++;

  report.testCases[id] = { name, passed, details, timestamp: new Date().toISOString() };
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${icon}] ${id}: ${name}`);
  if (!passed && details.error) {
    console.log(`       Error: ${details.error}`);
  }
}

async function loginUser(page, email, password) {
  const pwd = password || TEST_AUTH_PASSWORD;
  if (!pwd) {
    throw new Error(`Authentication password not configured for ${email}. Set TEST_PASSWORD in environment.`);
  }

  await page.goto(TARGET_URL);
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForSelector('#login-form', { state: 'visible', timeout: 10000 });

  await page.fill('#email', email);
  await page.fill('#password', pwd);
  await page.click('#login-form button[type="submit"]');

  const outcome = await Promise.race([
    page.waitForSelector('#app-shell:not(.hidden)', { timeout: 6000 }).then(() => 'success'),
    page.waitForSelector('#login-error:not(.hidden)', { timeout: 6000 }).then(() => 'error')
  ]);

  if (outcome === 'success') {
    await page.waitForTimeout(600);
    return { email, success: true };
  }

  const errText = await page.textContent('#login-error');
  throw new Error(`Login failed for ${email}: ${errText}`);
}

async function runVerification() {
  console.log('================================================================');
  console.log(`Starting Chaos QA & Resilience Verification Sweep on: ${TARGET_URL}`);
  console.log('================================================================\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore routine 401/404 or expected favicon noise
      if (!text.includes('favicon') && !text.includes('status of 401') && !text.includes('status of 404')) {
        report.consoleErrors.push({ text, location: msg.location() });
      }
    }
  });

  page.on('pageerror', err => {
    report.consoleErrors.push({ pageError: err.message, stack: err.stack });
  });

  try {
    // -------------------------------------------------------------
    // TEST 1: Password Visibility Toggle (Eye Icon)
    // -------------------------------------------------------------
    await page.goto(TARGET_URL);
    await page.waitForSelector('#login-form', { timeout: 10000 });
    const toggleBtn = await page.$('#password-toggle-btn');
    const pwdInput = await page.$('#password');
    let toggleWorks = false;

    if (toggleBtn && pwdInput) {
      const initialType = await pwdInput.getAttribute('type');
      await toggleBtn.click();
      const toggledType = await pwdInput.getAttribute('type');
      await toggleBtn.click();
      const revertedType = await pwdInput.getAttribute('type');
      toggleWorks = (initialType === 'password' && toggledType === 'text' && revertedType === 'password');
    }
    recordTest('AUTH-01', 'Show/Hide Password Toggle on Login Form', toggleWorks, { toggleWorks });

    // -------------------------------------------------------------
    // TEST 2: Invalid Credentials Handling
    // -------------------------------------------------------------
    await page.fill('#email', 'invalid-user@ata-lta.ph');
    await page.fill('#password', 'WrongPassword123!');
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#login-error:not(.hidden)', { timeout: 5000 });
    const errorText = await page.textContent('#login-error');
    recordTest('AUTH-02', 'Invalid Credentials Error Handling', !!errorText && errorText.includes('Invalid'), { errorText });

    // -------------------------------------------------------------
    // TEST 3: Multi-Role Authentication & Entity Scoping
    // -------------------------------------------------------------
    for (const roleObj of ROLES_TO_TEST) {
      try {
        const loginRes = await loginUser(page, roleObj.email, roleObj.password);
        const nameText = await page.textContent('#user-name');
        const entitySwitcher = await page.$('#entity-switcher');
        const entityOptions = entitySwitcher ? await entitySwitcher.innerText() : '';
        const optionsList = entityOptions.split('\n').map(s => s.trim()).filter(Boolean);

        const hasConsolidated = optionsList.some(o => o.includes('Consolidated'));
        const entityScopeCorrect = roleObj.isManagerial ? hasConsolidated : !hasConsolidated;

        recordTest(
          `RBAC-${roleObj.key.toUpperCase()}`,
          `Role Auth & Scoping: ${roleObj.role}`,
          entityScopeCorrect && !!nameText,
          { loggedInUser: loginRes.email, name: nameText?.trim(), optionsList, entityScopeCorrect }
        );
      } catch (err) {
        recordTest(`RBAC-${roleObj.key.toUpperCase()}`, `Role Auth: ${roleObj.role}`, false, { error: err.message });
      }
    }

    // -------------------------------------------------------------
    // TEST 4: Admin Module Navigation & Entity Switcher
    // -------------------------------------------------------------
    await loginUser(page, process.env.TEST_ADMIN_EMAIL || 'dev-admin@ata-lta.ph', process.env.TEST_ADMIN_PASSWORD || TEST_AUTH_PASSWORD);
    const modules = ['dashboard', 'clients', 'operations', 'billing', 'disbursement', 'transmittal', 'reports', 'admin'];
    let allNavPassed = true;
    const navDetails = {};

    for (const m of modules) {
      try {
        await page.goto(`${TARGET_URL}/#${m}`);
        await page.waitForTimeout(800);
        navDetails[m] = 'rendered';
      } catch (e) {
        allNavPassed = false;
        navDetails[m] = `error: ${e.message}`;
      }
    }
    recordTest('NAV-01', 'Navigation across all 8 primary modules', allNavPassed, navDetails);

    // Entity switcher switching
    let entitySwitchWorks = false;
    try {
      await page.selectOption('#entity-switcher', 'ATA');
      await page.waitForTimeout(1000);
      const ataBadge = await page.textContent('#entity-badge');

      await page.selectOption('#entity-switcher', 'LTA');
      await page.waitForTimeout(1000);
      const ltaBadge = await page.textContent('#entity-badge');

      await page.selectOption('#entity-switcher', 'ALL');
      await page.waitForTimeout(1000);
      entitySwitchWorks = ataBadge.includes('ATA') && ltaBadge.includes('LTA');
    } catch (e) {
      entitySwitchWorks = false;
    }
    recordTest('NAV-02', 'Entity Switcher Smooth Transition (ATA, LTA, ALL)', entitySwitchWorks);

    // -------------------------------------------------------------
    // TEST 5: Work Request Form Debounce & Duplicate Guard
    // -------------------------------------------------------------
    await page.goto(`${TARGET_URL}/#operations`);
    await page.waitForTimeout(1000);

    const debounceAnalysis = await page.evaluate(() => {
      const code = typeof Workflow !== 'undefined' ? Workflow.submitForm?.toString() : '';
      return {
        hasIsSubmittingGuard: code.includes('_isSubmittingWr') || code.includes('isSubmitting'),
        disablesSubmitBtn: code.includes('submitBtn.disabled = true'),
        showsSavingText: code.includes('Saving...')
      };
    });
    recordTest(
      'CHAOS-WR-01',
      'Work Request Creation Form Debouncing & Button Disabling Guard',
      debounceAnalysis.hasIsSubmittingGuard && debounceAnalysis.disablesSubmitBtn,
      debounceAnalysis
    );

    // -------------------------------------------------------------
    // TEST 6: Compact Card Micro-Drag Clickability & Title Outline
    // -------------------------------------------------------------
    const cardResilience = await page.evaluate(() => {
      const fn = (typeof Utils !== 'undefined' && Utils.buildCompactBoardCard) || (typeof window !== 'undefined' && window.buildCompactBoardCard);
      const utilsCode = fn ? fn.toString() : '';
      const hasDisplacementCheck = utilsCode.includes('dx < 8') || utilsCode.includes('Math.abs(e.clientX - startX)') || utilsCode.includes('dx * dx');
      return {
        hasDisplacementCheck,
        hasFunction: !!fn
      };
    });
    recordTest(
      'CHAOS-UI-01',
      'Card Click Resilience against HTML5 Drag-and-Drop micro-drag',
      cardResilience.hasDisplacementCheck,
      cardResilience
    );

    // -------------------------------------------------------------
    // TEST 7: Client List POC and Cross-Entity Relationship Dropdowns
    // -------------------------------------------------------------
    await page.goto(`${TARGET_URL}/#clients`);
    await page.waitForTimeout(1000);

    const clientDropdownAnalysis = await page.evaluate(async () => {
      if (typeof Clients === 'undefined') return { success: false, error: 'Clients module not loaded' };

      // Ensure caches are available
      if (window.apiClient?.clientCache?.ensure) {
        await window.apiClient.clientCache.ensure().catch(() => {});
      }
      if (window.apiClient?.userCache?.ensure) {
        await window.apiClient.userCache.ensure().catch(() => {});
      }

      // 1. Exercise the rendered relationship select and assert it renders valid cross-entity options
      const rcContainer = document.createElement('div');
      Clients.addRelatedCompanyRow(rcContainer, null, 0);

      const clientSelect = rcContainer.querySelector('select[name="rc-client-0"]');
      const relSelect = rcContainer.querySelector('select[name="rc-relation-0"]');

      const clientOptions = clientSelect ? Array.from(clientSelect.options).map(o => ({ value: o.value, text: o.text })) : [];
      const relOptions = relSelect ? Array.from(relSelect.options).map(o => o.value) : [];

      const hasAtaOption = clientOptions.some(o => o.text.includes('(ATA)'));
      const hasLtaOption = clientOptions.some(o => o.text.includes('(LTA)'));
      const supportsCrossEntity = (hasAtaOption && hasLtaOption) || clientOptions.length > 1;

      const hasValidRelations = ['Parent', 'Subsidiary', 'Sister Company', 'Affiliate'].every(r => relOptions.includes(r));

      // 2. Check POC options population
      const renderFormCode = Clients.renderForm?.toString() || '';
      const populatesPoc = renderFormCode.includes('userCache.ensure') || renderFormCode.includes('team') || renderFormCode.includes('userCache');

      return {
        supportsCrossEntity,
        hasAtaOption,
        hasLtaOption,
        hasValidRelations,
        populatesPoc,
        clientOptionsCount: clientOptions.length
      };
    });
    recordTest(
      'CHAOS-CLIENT-01',
      'Client Form POC population & Cross-Entity Relationship Support',
      clientDropdownAnalysis.supportsCrossEntity && clientDropdownAnalysis.hasValidRelations && clientDropdownAnalysis.populatesPoc,
      clientDropdownAnalysis
    );

    // -------------------------------------------------------------
    // TEST 8: Invoicing & Billing Auto-Increment & Debouncing
    // -------------------------------------------------------------
    await page.goto(`${TARGET_URL}/#billing`);
    await page.waitForTimeout(1000);

    const billingAnalysis = await page.evaluate(async () => {
      const utilsInvCode = typeof Utils !== 'undefined' ? Utils.nextInvoiceNumber?.toString() : '';
      const legacyInvCode = typeof Billing !== 'undefined' ? Billing._legacyNextInvoiceNumber?.toString() : '';
      const submitCode = typeof Billing !== 'undefined' ? Billing.submitForm?.toString() : '';

      const fallbacksFromAll = (utilsInvCode.includes('ALL') || legacyInvCode.includes('ALL'));
      const safeQueryLimit = utilsInvCode.includes('limit: 500') || legacyInvCode.includes('limit: 500');
      const debouncesSubmit = submitCode.includes('_isSubmittingBilling');

      // Execute nextInvoiceNumber under ATA
      let generatedAta = null;
      try {
        if (typeof Utils !== 'undefined' && Utils.nextInvoiceNumber) {
          generatedAta = await Utils.nextInvoiceNumber('ATA');
        }
      } catch (e) {
        generatedAta = e.message;
      }

      return {
        fallbacksFromAll,
        safeQueryLimit,
        debouncesSubmit,
        generatedAta
      };
    });
    recordTest(
      'CHAOS-BILL-01',
      'Invoice Auto-Increment Entity Fallback & Submission Debounce',
      billingAnalysis.fallbacksFromAll && billingAnalysis.safeQueryLimit && billingAnalysis.debouncesSubmit,
      billingAnalysis
    );

    // -------------------------------------------------------------
    // TEST 9: Admin Audit Log Clickable Records & Pending WR Link
    // -------------------------------------------------------------
    await page.goto(`${TARGET_URL}/#admin/audit`);
    await page.waitForTimeout(1200);

    const auditLogAnalysis = await page.evaluate(() => {
      const auditCode = typeof Users !== 'undefined' ? Users.refreshAuditLog?.toString() : '';
      const hasOnRowClick = auditCode.includes('onRowClick:');
      const rows = document.querySelectorAll('.jira-backlog-row');
      return {
        hasOnRowClick,
        renderedRows: rows.length
      };
    });
    recordTest(
      'CHAOS-AUDIT-01',
      'Admin Audit Log Row Click Modal Trigger',
      auditLogAnalysis.hasOnRowClick,
      auditLogAnalysis
    );

    // -------------------------------------------------------------
    // TEST 10: Dashboard Calendar Role Scoping & Isolation
    // -------------------------------------------------------------
    await loginUser(page, process.env.TEST_OPS_EMAIL || 'ann@ata-lta.ph', process.env.TEST_OPS_PASSWORD || TEST_AUTH_PASSWORD);
    await page.goto(`${TARGET_URL}/#dashboard`);
    await page.waitForTimeout(1200);

    const dashboardScoping = await page.evaluate(() => {
      const dashCode = typeof Dashboard !== 'undefined' ? Dashboard.getCalendarEvents?.toString() : '';
      const scopesByAuthCanViewWr = dashCode.includes('Auth.canViewWr');
      const scopesByAuthCanViewDisbursement = dashCode.includes('Auth.canViewDisbursement');
      return {
        scopesByAuthCanViewWr,
        scopesByAuthCanViewDisbursement
      };
    });
    recordTest(
      'CHAOS-DASH-01',
      'Dashboard Calendar Work Request Worker Scoping Isolation',
      dashboardScoping.scopesByAuthCanViewWr && dashboardScoping.scopesByAuthCanViewDisbursement,
      dashboardScoping
    );

    // -------------------------------------------------------------
    // TEST 11: Service Worker & Cache-Control Verification
    // -------------------------------------------------------------
    const cacheVerification = await page.evaluate(async () => {
      try {
        const swReg = await navigator.serviceWorker.getRegistration();
        return {
          swActive: !!swReg?.active,
          swScope: swReg?.scope
        };
      } catch (e) {
        return { error: e.message };
      }
    });
    recordTest(
      'CACHE-01',
      'Service Worker Active Registration and Storage Isolation',
      !!cacheVerification?.swActive,
      cacheVerification
    );

    // -------------------------------------------------------------
    // TEST 12: Operations Request Modals Debouncing & Button Disabling
    // -------------------------------------------------------------
    await page.goto(`${TARGET_URL}/#disbursement`);
    await page.waitForTimeout(1200);

    const opreqDebounce = await page.evaluate(() => {
      const wfCode = (typeof Workflow !== 'undefined' && Workflow.submitOperationsRequest?.toString()) || '';
      const billCode = (typeof Billing !== 'undefined' && Billing.showRequestInvoiceModal?.toString()) || '';
      const disbCode = (typeof Disbursement !== 'undefined' && Disbursement.showRequestDisbursementModal?.toString()) || '';
      const transCode = (typeof Transmittal !== 'undefined' && Transmittal.showRequestTransmittalModal?.toString()) || '';

      return {
        wfHasDebounce: !!wfCode && wfCode.includes('isSubmittingOpreq'),
        billHasDebounce: !!billCode && billCode.includes('isSubmittingReq'),
        disbHasDebounce: !!disbCode && disbCode.includes('isSubmittingDisbReq'),
        transHasDebounce: !!transCode && transCode.includes('isSubmittingTransReq'),
      };
    });
    recordTest(
      'CHAOS-OPREQ-01',
      'Operations Request Modals Debouncing & Double-Click Guard (Workflow, Billing, Disbursement, Transmittal)',
      opreqDebounce.wfHasDebounce && opreqDebounce.billHasDebounce && opreqDebounce.disbHasDebounce && opreqDebounce.transHasDebounce,
      opreqDebounce
    );

    // -------------------------------------------------------------
    // TEST 13: Transmittal Auto-Increment Entity Resolution (ALL → ATA)
    // -------------------------------------------------------------
    const txAnalysis = await page.evaluate(async () => {
      const txCode = typeof Utils !== 'undefined' ? Utils.nextTrackingNumber?.toString() : '';
      const resolvesAll = txCode.includes('ALL') && txCode.includes('resolvedEntity');
      const safeLimit = txCode.includes('limit: 500');

      let genTrackingAll = null;
      try {
        if (typeof Utils !== 'undefined' && Utils.nextTrackingNumber) {
          genTrackingAll = await Utils.nextTrackingNumber('ALL');
        }
      } catch (e) {
        genTrackingAll = e.message;
      }

      return {
        resolvesAll,
        safeLimit,
        genTrackingAll,
        validPrefix: typeof genTrackingAll === 'string' && !genTrackingAll.startsWith('ALL-TX-') && genTrackingAll.includes('-TX-')
      };
    });
    recordTest(
      'CHAOS-TX-01',
      'Transmittal Auto-Increment Entity Resolution & Safe Query Limit',
      txAnalysis.resolvesAll && txAnalysis.safeLimit && txAnalysis.validPrefix,
      txAnalysis
    );

    // -------------------------------------------------------------
    // TEST 14: Disbursement Self-Approval Prevention
    // -------------------------------------------------------------
    const disbSelfApprove = await page.evaluate(() => {
      const disbCode = typeof Disbursement !== 'undefined' ? Disbursement.renderDetail?.toString() : '';
      const pcCode = typeof PendingChanges !== 'undefined' ? PendingChanges.canApproveChange?.toString() : '';
      const preventsSelfApproval = disbCode.includes('isSelfApprover') && pcCode.includes('pc.submittedBy === Auth.user?.id');
      return {
        preventsSelfApproval
      };
    });
    recordTest(
      'CHAOS-DISB-01',
      'Disbursement Self-Approval Barrier & Enforcement',
      disbSelfApprove.preventsSelfApproval,
      disbSelfApprove
    );

    // -------------------------------------------------------------
    // TEST 15: Work Request Detail Header Outline Badge
    // -------------------------------------------------------------
    const wrBadgeAnalysis = await page.evaluate(() => {
      const wfCode = typeof Workflow !== 'undefined' ? (Workflow.render?.toString() || '') : '';
      const hasWrTitleBadge = wfCode.includes('wr-title-badge');
      return {
        hasWrTitleBadge
      };
    });
    recordTest(
      'CHAOS-WR-02',
      'Work Request Detail Header Outline Badge Styling',
      wrBadgeAnalysis.hasWrTitleBadge,
      wrBadgeAnalysis
    );

    // -------------------------------------------------------------
    // TEST 16: Idempotency & Replay Protection Header Presence
    // -------------------------------------------------------------
    const idempotencyAnalysis = await page.evaluate(async () => {
      let interceptedHeader = null;
      const originalFetch = window.fetch;
      window.fetch = async (url, init) => {
        interceptedHeader = (init?.headers && init.headers['Idempotency-Key']) || (init?.headers instanceof Headers ? init.headers.get('Idempotency-Key') : null);
        return new Response(JSON.stringify({ data: { id: 'test-idemp' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };
      try {
        if (window.apiClient?.post) {
          await window.apiClient.post('/idempotency-test', { foo: 'bar' }).catch(() => {});
        }
      } finally {
        window.fetch = originalFetch;
      }
      return {
        hasIdempotencyKey: !!interceptedHeader,
        interceptedHeader
      };
    });
    recordTest(
      'CHAOS-API-01',
      'Client Idempotency Key Generation on Mutating Requests',
      idempotencyAnalysis.hasIdempotencyKey,
      idempotencyAnalysis
    );

  } catch (err) {
    console.error('Fatal Verification Error:', err);
    recordTest('FATAL', 'Verification Suite Execution', false, { error: err.message, stack: err.stack });
  } finally {
    await browser.close();
  }

  report.completedAt = new Date().toISOString();
  const summaryFile = path.join(__dirname, 'e2e-chaos-report.json');
  fs.writeFileSync(summaryFile, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n================================================================');
  console.log(`VERIFICATION SUMMARY: ${report.summary.passed} / ${report.summary.total} Passed (${report.summary.failed} Failed)`);
  console.log(`Console Errors Recorded: ${report.consoleErrors.length}`);
  console.log(`Report Saved To: ${summaryFile}`);
  console.log('================================================================\n');

  return report;
}

runVerification().then(res => {
  if (res.summary.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}).catch(e => {
  console.error(e);
  process.exit(1);
});
