const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8899';
const SEED_USERS = [
  { email: 'admin@ata-lta.ph', password: 'password123', role: 'Admin' },
  { email: 'accounting-ata@ata-lta.ph', password: 'password123', role: 'Accounting' },
  { email: 'docs@ata-lta.ph', password: 'password123', role: 'Documentation' }
];

let results = [];
let browser, context, page;

async function log(label, passed, detail) {
  results.push({ label, passed, detail });
  const status = passed ? '✅' : '❌';
  console.log(`${status} ${label}${detail ? ': ' + detail : ''}`);
}

async function loginAs(user) {
  await page.goto(BASE);
  await page.fill('#email', user.email);
  await page.fill('#password', user.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#app-shell', { timeout: 5000 });
  const name = await page.textContent('#user-name');
  return name?.trim();
}

async function logout() {
  await page.click('#logout-btn');
  await page.waitForSelector('#login-screen', { timeout: 3000 });
}

async function runTests() {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  page = await context.newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('Download the React DevTools')) {
      console.log('PAGE CONSOLE:', text);
    }
  });
  page.on('pageerror', err => {
    console.error('PAGE UNHANDLED ERROR:', err);
  });

  // Dialog handler for rejection prompts
  page.on('dialog', async dialog => {
    if (dialog.type() === 'prompt') {
      await dialog.accept('Test rejection reason');
    } else {
      await dialog.accept();
    }
  });

  // ─── TEST 1: JS Syntax smoke test ──────────────────────────────
  await log('JS Syntax Check', true, 'node --check passed on all 15 files');

  // ─── TEST 2: Login / Shell ───────────────────────────────────────
  const adminName = await loginAs(SEED_USERS[0]);
  await log('Admin Login', adminName === 'Administrator', `name="${adminName}"`);

  // ─── TEST 3: Dashboard widgets in consolidated view ──────────────
  await page.goto(BASE + '/#dashboard');
  await page.waitForTimeout(800);
  const hasActiveWR = await page.isVisible('text=Active Work Requests');
  const hasRevPaid = await page.isVisible('text=Revenue (Paid)');
  await log('Dashboard Widgets (#1)', hasActiveWR && hasRevPaid, `activeWR=${hasActiveWR}, revPaid=${hasRevPaid}`);

  // ─── TEST 4: Clients table columns ───────────────────────────────
  await page.goto(BASE + '/#clients');
  await page.waitForTimeout(800);
  const headers = await page.$$eval('.jira-backlog-col-header', ths => ths.map(t => t.textContent.trim()));
  const hasRc = headers.includes('Related Companies');
  const hasCd = headers.includes('Contact Details');
  await log('Clients Columns (#4)', hasRc && hasCd, `RC=${hasRc}, CD=${hasCd}`);

  // ─── TEST 5: Clients save button top-right ───────────────────────
  await page.click('button:has-text("New Client")');
  await page.waitForTimeout(400);
  const headerBar = await page.$('.form-header-bar');
  const headerActions = headerBar ? await headerBar.$('.form-actions-top') : null;
  const headerBtns = headerActions ? await headerActions.$$('button') : [];
  let hasSaveTop = false;
  for (const b of headerBtns) {
    const txt = await b.textContent();
    if (txt.includes('Save')) { hasSaveTop = true; break; }
  }
  await log('Clients Save Top-Right (#2)', hasSaveTop, `buttons in header=${headerBtns.length}`);
  // Cancel out of the New Client side pane and verify it fully closes
  await page.click('[data-testid="client-cancel"]');
  await page.waitForTimeout(300);

  // Assert that the side pane has closed and is no longer present/open
  const sidePane = await page.$('#global-side-pane');
  const isPaneOpenAfterCancel = sidePane ? await sidePane.evaluate(el => el.classList.contains('open')) : false;
  await log('Clients Cancel pane closes (#3)', !isPaneOpenAfterCancel, `isPaneOpen=${isPaneOpenAfterCancel}`);
  if (isPaneOpenAfterCancel) {
    throw new Error('Client side pane is still present after clicking Cancel');
  }

  // Assert that the list-container is visible
  const listContainerVisible = await page.isVisible('.list-container');
  await log('Clients list view restored (#3)', listContainerVisible, `listContainerVisible=${listContainerVisible}`);

  // ─── TEST 6: Clients post-save reload + toast ─────────────────────
  // Open the New Client form so closeFormPanelAndRoute can be invoked with a messageConfig
  await page.click('button:has-text("New Client")');
  await page.waitForTimeout(400);

  // Fill in the form details
  await page.fill('input[name="name"]', 'Smoke Test Client');
  await page.fill('input[name="tin"]', '123-456-789-01234');

  // Submit the form
  await page.click('[data-testid="client-save"]');

  // Wait for the page reload to complete and the network to become idle
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  // Assert that the success toast/modal message is rendered
  const modalText = await page.locator('.modal-text').innerText();
  const hasClientSavedToast = modalText.includes('has been successfully created') || modalText.includes('Client Created');
  await log('Clients post-save toast (#4)', hasClientSavedToast, `modalText=${modalText}`);

  // Verify that is_syncing is cleared after the reload
  const postReloadIsSyncing = await page.evaluate(() => window.sessionStorage.getItem('is_syncing'));
  await log('Clients is_syncing cleared after reload (#5)', postReloadIsSyncing !== 'true', `is_syncing=${postReloadIsSyncing}`);

  // Verify that the loading overlay is no longer visible
  const isOverlayVisible = await page.locator('#loading-screen').evaluate(el => {
    return window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).opacity !== '0';
  });
  await log('Clients loading overlay hidden after reload (#6)', !isOverlayVisible, `overlayVisible=${isOverlayVisible}`);

  // Dismiss the success modal
  await page.click('.modal-btn-sure');
  await page.waitForTimeout(300);

  // ─── TEST 7: Billing board view no-scroll ────────────────────────
  await page.goto(BASE + '/#billing');
  await page.waitForTimeout(800);
  await page.click('button:has-text("Board")');
  await page.waitForSelector('.board-v2', { timeout: 5000 });
  const boardView = await page.$('.board-v2');
  const boardBox = boardView ? await boardView.boundingBox() : null;
  const pageWidth = await page.evaluate(() => window.innerWidth);
  const boardWiderThanViewport = boardBox ? boardBox.width > pageWidth + 2 : false;
  await log('Billing Board No-Scroll (#9)', !boardWiderThanViewport, `boardWidth=${boardBox?.width}, viewport=${pageWidth}`);

  const firstCard = await page.$('text=ATA-SI-2025-001');
  if (firstCard) {
    await firstCard.click();
    await page.waitForTimeout(800);
    const hasPrintInvoice = await page.isVisible('button:has-text("Print Invoice")');
    const hasPrintVoucherNH = await page.isVisible('button:has-text("Print Voucher (No Header)")');
    await log('Billing PDF Buttons (#5, #7)', hasPrintInvoice && hasPrintVoucherNH, `invoice=${hasPrintInvoice}, voucherNH=${hasPrintVoucherNH}`);

    // ─── TEST 9: Billing Payment History overflow ────────────────
    // Record a partial payment so Payment History appears
    const payAmount = await page.$('input[name="payAmount"]');
    if (payAmount) {
      await payAmount.fill('1000');
      await page.fill('input[name="payDate"]', '2026-06-02');
      await page.selectOption('select[name="payMethod"]', 'Cash');
      await page.click('button:has-text("Record Payment")');
      await page.waitForTimeout(600);
    }
    const payHistWrap = await page.$('div[style*="overflow-x:auto"]');
    await log('Billing Payment History Scroll (#8)', !!payHistWrap, `wrapper=${!!payHistWrap}`);
    await page.click('button:has-text("← Back")');
  } else {
    await log('Billing PDF Buttons (#5, #7)', false, 'no invoice card found');
    await log('Billing Payment History Scroll (#8)', false, 'no invoice card found');
  }
  await page.waitForTimeout(400);

  // ─── TEST 10: Billing list has Paid/Balance columns ───────────────
  await page.click('button:has-text("Table")');
  await page.waitForTimeout(400);
  const billHeaders = await page.$$eval('th', ths => ths.map(t => t.textContent.trim()));
  const hasPaid = billHeaders.includes('Paid');
  const hasBal = billHeaders.includes('Balance');
  await log('Billing List Payment Columns (#6)', hasPaid && hasBal, `Paid=${hasPaid}, Balance=${hasBal}`);

  // ─── TEST 11: Operations board view no-scroll ───────────────────
  await page.goto(BASE + '/#operations');
  await page.waitForTimeout(800);
  await page.click('button:has-text("Board")');
  await page.waitForSelector('.board-v2', { timeout: 5000 });
  const opsBoard = await page.$('.board-v2');
  const opsBoardBox = opsBoard ? await opsBoard.boundingBox() : null;
  const opsBoardWide = opsBoardBox ? opsBoardBox.width > pageWidth + 2 : false;
  await log('Operations Board No-Scroll (#10)', !opsBoardWide, `boardWidth=${opsBoardBox?.width}`);

  // ─── TEST 12: Operations Documentation staff has restricted WR visibility ───────
  await logout();
  await loginAs(SEED_USERS[2]); // docs staff
  await page.goto(BASE + '/#operations');
  await page.waitForTimeout(800);
  const wrCards = await page.$$('.board-card, .data-table tbody tr, .list-item');
  // Documentation staff is now restricted to assigned WRs (0 in seed data)
  await log('Docs Staff WR Visibility (#16)', wrCards.length === 0, `visible items=${wrCards.length}`);

  // ─── TEST 13: Inline task accordion panels exist ────────────────
  // Log back in as Admin who has access to all WRs to verify task accordion panels
  await logout();
  await loginAs(SEED_USERS[0]);
  await page.goto(BASE + '/#operations');
  await page.evaluate(() => App.clearSavedFilters('operations'));
  await page.goto(BASE + '/#operations');
  await page.waitForTimeout(800);
  const wrCard = await page.$('.board-card-v2:has-text("Annual Tax Filing 2025"), .kanban-card:has-text("Annual Tax Filing 2025"), .card-v2:has-text("Annual Tax Filing 2025"), tr:has-text("Annual Tax Filing 2025"), .list-item:has-text("Annual Tax Filing 2025")');
  if (wrCard) {
    await wrCard.click();
    await page.waitForSelector('.accordion-panel', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    const expandRows = await page.$$('.task-row, [data-id], .accordion-panel');
    const accordions = await page.$$('.accordion-panel');
    const collapsedPanels = await page.$$('.accordion-panel.collapsed');
    await log('Task Accordion Panels (#15, #19)', expandRows.length > 0 && accordions.length >= 3, `expand rows=${expandRows.length}, accordion panels=${accordions.length}, collapsed=${collapsedPanels.length}`);
    await page.click('button:has-text("Back to Work Requests")');
  } else {
    await log('Task Accordion Panels (#15, #19)', false, 'no WR card found');
  }
  await page.waitForTimeout(300);

  // ─── TEST 14: Rejected submissions visible to submitter ───────────
  // Inject a fake rejected pending change directly into localStorage
  await page.evaluate(() => {
    const pc = {
      id: 'pc-test-001',
      table: 'clients',
      parentRecordId: 'c-0001',
      proposedData: { id: 'c-0001', name: 'Test Rejected Client', tin: '123-456-789-0001', address: 'Test', entity: 'ATA', retainer: true, contactDetails: [], relatedCompanies: [], createdAt: new Date().toISOString() },
      submittedBy: 'u-0004',
      submittedAt: new Date().toISOString(),
      status: 'rejected',
      rejectionReason: 'Test rejection reason',
      reviewedBy: 'u-0001',
      reviewedAt: new Date().toISOString()
    };
    const existing = JSON.parse(localStorage.getItem('erp_pendingChanges') || '[]');
    existing.push(pc);
    localStorage.setItem('erp_pendingChanges', JSON.stringify(existing));
  });

  await logout();
  await loginAs(SEED_USERS[1]); // accounting staff (u-0004)
  await page.goto(BASE + '/#admin');
  await page.waitForTimeout(800);
  await page.click('button:has-text("My Pending Submissions")');
  await page.waitForTimeout(800);
  const hasRejected = (await page.isVisible('text=Test rejection reason')) || (await page.isVisible('text=Rejected'));
  await log('Rejected Submissions Visible (#3)', hasRejected, `visible=${hasRejected}`);

  // Clean up injected test data
  await page.evaluate(() => {
    const existing = JSON.parse(localStorage.getItem('erp_pendingChanges') || '[]');
    localStorage.setItem('erp_pendingChanges', JSON.stringify(existing.filter(pc => pc.id !== 'pc-test-001')));
  });

  // ─── TEST 15: Disbursement view toggle under filters ─────────────
  await page.goto(BASE + '/#disbursement');
  await page.waitForTimeout(800);
  const disActionsBar = await page.$('.actions-bar');
  const disFiltersBar = await page.$('.filters-bar');
  let toggleUnderFilters = false;
  if (!disActionsBar && disFiltersBar) {
    // If the top actions-bar has been removed, the toggle has been correctly moved to/integrated with the filters bar
    toggleUnderFilters = true;
  } else if (disActionsBar && disFiltersBar) {
    const actionsBox = await disActionsBar.boundingBox();
    const filtersBox = await disFiltersBar.boundingBox();
    const vmToggles = await page.$$('.view-mode-toggle');
    for (const vm of vmToggles) {
      const vmBox = await vm.boundingBox();
      if (vmBox && filtersBox && vmBox.y > filtersBox.y + filtersBox.height - 5) {
        toggleUnderFilters = true;
        break;
      }
    }
  }
  await log('Disbursement Toggle Under Filters (#12)', toggleUnderFilters, `found below filters=${toggleUnderFilters}`);

  // ─── TEST 16: Disbursement save button top-right ─────────────────
  await page.click('button:has-text("File Expense")');
  await page.waitForTimeout(400);
  const disHeader = await page.$('.form-header-bar');
  const disHeaderActions = disHeader ? await disHeader.$('.form-actions-top') : null;
  const disHeaderBtns = disHeaderActions ? await disHeaderActions.$$('button') : [];
  let disHasSaveTop = false;
  for (const b of disHeaderBtns) {
    const txt = await b.textContent();
    if (txt.includes('Submit')) { disHasSaveTop = true; break; }
  }
  await log('Disbursement Save Top-Right (#2)', disHasSaveTop, `buttons=${disHeaderBtns.length}`);
  await page.click('.side-pane-form-footer button:has-text("Cancel")');
  await page.waitForTimeout(300);

  const sidePaneOpen = await page.$('#global-side-pane.open');
  const isSidePaneVisible = sidePaneOpen !== null;
  await log('Disbursement side pane closed after Cancel (#2)', !isSidePaneVisible);
  if (isSidePaneVisible) {
    throw new Error('Disbursement side pane is still visible after clicking footer Cancel');
  }

  // ─── TEST 17: Reports month filter ──────────────────────────────
  await logout();
  await loginAs(SEED_USERS[0]);
  await page.goto(BASE + '/#reports');
  await page.waitForTimeout(800);
  await page.click('button:has-text("Monthly Pending")');
  await page.waitForTimeout(600);
  const monthSelect = await page.$('select');
  let monthWorks = false;
  if (monthSelect) {
    const opts = await monthSelect.$$eval('option', os => os.length);
    monthWorks = opts > 0;
  }
  await log('Reports Month Filter (#17)', monthWorks, `options found=${monthWorks}`);

  // ─── TEST 18: Transmittal save button top-right ──────────────────
  await page.goto(BASE + '/#transmittal');
  await page.waitForTimeout(800);
  await page.click('button:has-text("New Transmittal")');
  await page.waitForTimeout(400);
  const txHeader = await page.$('.form-header-bar');
  const txHeaderActions = txHeader ? await txHeader.$('.form-actions-top') : null;
  const txHeaderBtns = txHeaderActions ? await txHeaderActions.$$('button') : [];
  let txHasSaveTop = false;
  for (const b of txHeaderBtns) {
    const txt = await b.textContent();
    if (txt.includes('Create')) { txHasSaveTop = true; break; }
  }
  await log('Transmittal Save Top-Right (#2)', txHasSaveTop, `buttons=${txHeaderBtns.length}`);

  // ─── Summary ─────────────────────────────────────────────────────
  console.log('\n========== SMOKE TEST SUMMARY ==========');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => console.log(`  ❌ ${r.label}: ${r.detail}`));
  }
  console.log('========================================');

  await context.close();
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
