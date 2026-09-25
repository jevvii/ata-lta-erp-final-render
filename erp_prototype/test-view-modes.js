const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const ADMIN_EMAIL = 'lorein@ata-lta.ph';
const ADMIN_PASSWORD = 'Password@123';

const results = [];
function record(testName, passed, details = '') {
  results.push({ testName, passed, details });
  console.log(`${passed ? '✅' : '❌'} ${testName}${details ? ' - ' + details : ''}`);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', err => console.error('[PAGEERROR]', err.message));

  console.log('Navigating to', BASE_URL);
  await page.goto(BASE_URL);
  await page.waitForSelector('#email', { timeout: 20000 });
  await page.fill('#email', ADMIN_EMAIL);
  await page.fill('#password', ADMIN_PASSWORD);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 30000 });
  console.log('Logged in successfully!');

  // Navigate to #clients
  await page.click('a[data-module="clients"]');
  await page.waitForSelector('.jira-table tbody tr.jira-row', { timeout: 15000 });

  // ─────────────────────────────────────────────────────────────
  // 1. CLIENT EDIT: Open in side-peek (or default)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 1. Testing Client Edit: Default Open & Duplicate Title Removal ---');
  await page.click('.jira-table tbody tr.jira-row:first-child button[title="Edit Client"]');
  await page.waitForSelector('.side-pane.open', { timeout: 5000 });
  record('Client Edit opens in side pane', await page.isVisible('.side-pane.open'));

  // Check duplicate title: icon 🏢 exists, but NO h2 with client name
  const titleInfo = await page.evaluate(() => {
    const titleSec = document.querySelector('.side-pane-form-title');
    if (!titleSec) return { hasTitleSec: false };
    const icon = titleSec.querySelector('.side-pane-icon')?.innerText?.trim();
    const h2 = titleSec.querySelector('h2');
    return {
      hasTitleSec: true,
      icon,
      hasH2: !!h2,
      h2Text: h2 ? h2.innerText : null
    };
  });
  record('Topmost title keeps icon 🏢', titleInfo.icon === '🏢', `Found icon: ${titleInfo.icon}`);
  record('Topmost duplicate client name (h2) is removed', !titleInfo.hasH2, `Found h2: ${titleInfo.h2Text}`);

  // Form input still contains the client name
  const formClientName = await page.inputValue('#client-form input[name="name"]');
  record('Client name is present in the form input field', !!formClientName && formClientName.length > 0, `Value: ${formClientName}`);

  // ─────────────────────────────────────────────────────────────
  // 2. CLIENT EDIT: Expand to Full Page mode
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Testing Client Edit: Expand to Full Page Mode ---');
  await page.click('.side-pane-expand-btn');
  await page.waitForSelector('#content #client-form', { timeout: 10000 });
  await page.waitForTimeout(500);

  const fullPageUrl = page.url();
  record('URL transitions to #clients/form/:id', fullPageUrl.includes('#clients/form/'), `URL: ${fullPageUrl}`);
  record('Side pane is closed after expanding to full page', !(await page.isVisible('.side-pane.open')));
  record('Form is rendered in main #content area', await page.isVisible('#content #client-form'));

  const breadcrumbText = await page.textContent('.breadcrumb-h1');
  record('Breadcrumb displays client name and module path', breadcrumbText.includes('Clients') && breadcrumbText.includes(formClientName), `Breadcrumb: ${breadcrumbText}`);
  record('View switcher is present in full page breadcrumb', await page.isVisible('.form-view-switcher'));

  // ─────────────────────────────────────────────────────────────
  // 3. CLIENT EDIT: Switch from Full Page to Center Peek
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. Testing Client Edit: View Switcher -> Center Peek ---');
  await page.click('.form-view-switcher-btn');
  await page.waitForSelector('.form-view-switcher-menu.open', { timeout: 3000 });
  await page.click('.side-pane-view-menu-item[data-mode="center-peek"]');
  await page.waitForSelector('.side-pane.open.side-pane--center-peek', { timeout: 5000 });
  await page.waitForTimeout(500);

  record('Side pane opens in center-peek mode', await page.isVisible('.side-pane.open.side-pane--center-peek'));
  record('URL returns to #clients', page.url().endsWith('#clients'), `URL: ${page.url()}`);
  record('Center peek also suppresses duplicate title', !(await page.isVisible('.side-pane-form-title h2')));

  // ─────────────────────────────────────────────────────────────
  // 4. CLIENT EDIT: Switch from Center Peek back to Full Page via View Menu
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Testing Client Edit: View Menu -> Full Page ---');
  await page.click('.side-pane-view-menu-btn');
  await page.waitForSelector('.side-pane-view-menu.open', { timeout: 3000 });
  await page.click('.side-pane-view-menu-item[data-mode="full-page"]');
  await page.waitForSelector('#content #client-form', { timeout: 10000 });
  await page.waitForTimeout(500);

  record('Full page opens from view menu', page.url().includes('#clients/form/') && await page.isVisible('#content #client-form'));

  // ─────────────────────────────────────────────────────────────
  // 5. CLIENT EDIT: Switch from Full Page to Side Peek
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 5. Testing Client Edit: View Switcher -> Side Peek ---');
  await page.click('.form-view-switcher-btn');
  await page.waitForSelector('.form-view-switcher-menu.open', { timeout: 3000 });
  await page.click('.side-pane-view-menu-item[data-mode="side-peek"]');
  await page.waitForSelector('.side-pane.open.side-pane--side-peek', { timeout: 5000 });
  await page.waitForTimeout(500);

  record('Side pane opens in side-peek mode', await page.isVisible('.side-pane.open.side-pane--side-peek'));
  record('Side peek suppresses duplicate title', !(await page.isVisible('.side-pane-form-title h2')));

  // Close pane
  await page.click('.side-pane-close-btn');
  await page.waitForTimeout(500);
  record('Side pane closes on close button click', !(await page.isVisible('.side-pane.open')));

  // ─────────────────────────────────────────────────────────────
  // 6. CLIENT CREATE: View Modes Verification
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 6. Testing Client Create: View Modes ---');
  await page.click('button:has-text("New Client")');
  await page.waitForSelector('.side-pane.open', { timeout: 5000 });
  record('Client Create opens in side pane', await page.isVisible('.side-pane.open'));

  // For create, "Add Client" title SHOULD be present
  const createTitle = await page.textContent('.side-pane-form-title h2').catch(() => '');
  record('Client Create displays "Add Client" title', createTitle.includes('Add Client'), `Found title: ${createTitle}`);

  // Expand Create to Full Page
  await page.click('.side-pane-expand-btn');
  await page.waitForSelector('#content #client-form', { timeout: 10000 });
  await page.waitForTimeout(500);

  record('Client Create URL transitions to #clients/form/new', page.url().endsWith('#clients/form/new'));
  record('Client Create form is visible in #content', await page.isVisible('#content #client-form'));

  // Cancel from full page
  await page.click('button:has-text("Cancel")');
  await page.waitForSelector('.jira-table tbody tr.jira-row', { timeout: 10000 });
  record('Cancel returns cleanly to #clients list', page.url().endsWith('#clients'));

  // ─────────────────────────────────────────────────────────────
  // 7. SUMMARY
  // ─────────────────────────────────────────────────────────────
  console.log('\n=============================================');
  const passedCount = results.filter(r => r.passed).length;
  console.log(`TOTAL: ${results.length} | PASSED: ${passedCount} | FAILED: ${results.length - passedCount}`);
  console.log('=============================================');

  await browser.close();
  if (passedCount !== results.length) {
    process.exit(1);
  }
})();
