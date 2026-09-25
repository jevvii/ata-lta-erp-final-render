/**
 * Comprehensive Playwright test for Inner Tab Count Indicators across:
 * - Clients List (#clients)
 * - Operations (#operations)
 * - Billing (#billing)
 * - Disbursement (#disbursement)
 * - Transmittal (#transmittal)
 *
 * Verifies:
 * 1. Counts are accurate on first visit (NOT stuck at 0)
 * 2. Counts stay consistent across tab transitions
 * 3. Counts are accurate on direct deep link / hard refresh
 */

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'https://ata-lta-erp-spa-staging.onrender.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lorein@ata-lta.ph';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Password@123';

const results = [];

function record(suite, testName, passed, details = '') {
  results.push({ suite, testName, passed, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${suite}] ${testName}${details ? ' - ' + details : ''}`);
}

async function getTabCounts(page) {
  return await page.evaluate(() => {
    const nav = document.querySelector('.module-tab-nav');
    if (!nav) return null;
    const tabs = {};
    const links = nav.querySelectorAll('.module-tab-link');
    links.forEach(link => {
      // Find badge
      const badge = link.querySelector('.module-badge-count');
      const badgeCount = badge ? parseInt(badge.textContent.trim(), 10) : null;
      // Get label text excluding badge
      const clone = link.cloneNode(true);
      const b = clone.querySelector('.module-badge-count');
      if (b) b.remove();
      const label = clone.textContent.trim();
      tabs[label] = {
        count: isNaN(badgeCount) ? null : badgeCount,
        active: link.classList.contains('active'),
      };
    });
    return tabs;
  });
}

async function waitForTabCounts(page, expectedLabels, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const counts = await getTabCounts(page);
    if (counts) {
      const allFound = expectedLabels.every(label => counts[label] !== undefined && counts[label].count !== null);
      if (allFound) return counts;
    }
    await page.waitForTimeout(200);
  }
  return await getTabCounts(page);
}

async function runTests() {
  console.log('====================================================');
  console.log('STARTING INNER TAB COUNT INDICATOR VERIFICATION TEST');
  console.log(`Target URL: ${BASE_URL}`);
  console.log('====================================================\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Listen for console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.warn(`[Browser Error]: ${msg.text()}`);
    }
  });

  try {
    // ─── LOGIN ──────────────────────────────────────────
    console.log('Logging in as Admin...');
    await page.goto(BASE_URL);
    await page.waitForSelector('#email', { timeout: 20000 });
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 30000 });
    await page.waitForTimeout(1000);
    console.log('Admin login successful.\n');

    // ─── 1. CLIENTS LIST MODULE ──────────────────────────
    console.log('--- Testing Clients List Module ---');
    await page.click('a[data-module="clients"]');
    await page.waitForSelector('.module-tab-nav', { timeout: 10000 });
    
    // Initial visit check:
    let clientCounts = await waitForTabCounts(page, ['Active Clients', 'Archive']);
    const activeClientsCount = clientCounts['Active Clients']?.count;
    const archiveClientsCount = clientCounts['Archive']?.count;
    
    record('Clients', 'First visit: Active Clients count is accurate (9)', activeClientsCount === 9, `Found: ${activeClientsCount}`);
    record('Clients', 'First visit: Archive count is accurate (5)', archiveClientsCount === 5, `Found: ${archiveClientsCount}`);

    // Transition to Archive tab:
    await page.click('.module-tab-link:has-text("Archive")');
    await page.waitForTimeout(500);
    clientCounts = await getTabCounts(page);
    record('Clients', 'Inner transition: Active Clients count preserved on Archive tab (9)', clientCounts['Active Clients']?.count === 9, `Found: ${clientCounts['Active Clients']?.count}`);
    record('Clients', 'Inner transition: Archive count preserved on Archive tab (5)', clientCounts['Archive']?.count === 5, `Found: ${clientCounts['Archive']?.count}`);

    // Transition back to Active tab:
    await page.click('.module-tab-link:has-text("Active Clients")');
    await page.waitForTimeout(500);
    clientCounts = await getTabCounts(page);
    record('Clients', 'Inner transition: Counts preserved returning to Active Clients (9, 5)', clientCounts['Active Clients']?.count === 9 && clientCounts['Archive']?.count === 5, `Found: ${JSON.stringify(clientCounts)}`);

    // Hard refresh on deep link #clients?tab=archived:
    await page.goto(`${BASE_URL}/#clients?tab=archived`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.module-tab-nav', { timeout: 10000 });
    clientCounts = await waitForTabCounts(page, ['Active Clients', 'Archive']);
    record('Clients', 'Hard refresh at #clients?tab=archived retains accurate counts (9, 5)', clientCounts['Active Clients']?.count === 9 && clientCounts['Archive']?.count === 5, `Found: ${JSON.stringify(clientCounts)}`);

    // ─── 2. OPERATIONS MODULE ────────────────────────────
    console.log('\n--- Testing Operations Module ---');
    await page.click('a[data-module="operations"]');
    await page.waitForSelector('.module-tab-nav', { timeout: 10000 });

    let opCounts = await waitForTabCounts(page, ['Work Requests', 'Retainer Templates', 'Archive']);
    const wrCount = opCounts['Work Requests']?.count;
    const rtCount = opCounts['Retainer Templates']?.count;
    const opArchiveCount = opCounts['Archive']?.count;

    record('Operations', 'First visit: Work Requests count is accurate (5)', wrCount === 5, `Found: ${wrCount}`);
    record('Operations', 'First visit: Retainer Templates count is 0', rtCount === 0, `Found: ${rtCount}`);
    record('Operations', 'First visit: Archive count is 0', opArchiveCount === 0, `Found: ${opArchiveCount}`);

    // Transition to Retainer Templates tab:
    await page.click('.module-tab-link:has-text("Retainer Templates")');
    await page.waitForTimeout(500);
    opCounts = await getTabCounts(page);
    record('Operations', 'Inner transition to Retainer Templates preserves counts (5, 0, 0)', opCounts['Work Requests']?.count === 5 && opCounts['Retainer Templates']?.count === 0 && opCounts['Archive']?.count === 0, `Found: ${JSON.stringify(opCounts)}`);

    // Transition to Archive tab:
    await page.click('.module-tab-link:has-text("Archive")');
    await page.waitForTimeout(500);
    opCounts = await getTabCounts(page);
    record('Operations', 'Inner transition to Archive preserves counts (5, 0, 0)', opCounts['Work Requests']?.count === 5 && opCounts['Retainer Templates']?.count === 0 && opCounts['Archive']?.count === 0, `Found: ${JSON.stringify(opCounts)}`);

    // Transition back to Work Requests:
    await page.click('.module-tab-link:has-text("Work Requests")');
    await page.waitForTimeout(500);
    opCounts = await getTabCounts(page);
    record('Operations', 'Inner transition back to Work Requests preserves counts (5, 0, 0)', opCounts['Work Requests']?.count === 5 && opCounts['Retainer Templates']?.count === 0 && opCounts['Archive']?.count === 0, `Found: ${JSON.stringify(opCounts)}`);

    // Hard refresh on deep link #operations?tab=archive:
    await page.goto(`${BASE_URL}/#operations?tab=archive`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.module-tab-nav', { timeout: 10000 });
    opCounts = await waitForTabCounts(page, ['Work Requests', 'Retainer Templates', 'Archive']);
    record('Operations', 'Hard refresh at #operations?tab=archive retains accurate counts (5, 0, 0)', opCounts['Work Requests']?.count === 5 && opCounts['Retainer Templates']?.count === 0 && opCounts['Archive']?.count === 0, `Found: ${JSON.stringify(opCounts)}`);

    // ─── 3. BILLING MODULE ───────────────────────────────
    console.log('\n--- Testing Billing Module ---');
    await page.click('a[data-module="billing"]');
    await page.waitForSelector('.module-tab-nav', { timeout: 10000 });

    let billingCounts = await waitForTabCounts(page, ['Invoices', 'Templates', 'Archive']);
    record('Billing', 'First visit: Invoices count is accurate (0)', billingCounts['Invoices']?.count === 0, `Found: ${billingCounts['Invoices']?.count}`);
    record('Billing', 'First visit: Templates count is 0', billingCounts['Templates']?.count === 0, `Found: ${billingCounts['Templates']?.count}`);
    record('Billing', 'First visit: Archive count is 0', billingCounts['Archive']?.count === 0, `Found: ${billingCounts['Archive']?.count}`);

    // Transition to Templates tab:
    await page.click('.module-tab-link:has-text("Templates")');
    await page.waitForTimeout(500);
    billingCounts = await getTabCounts(page);
    record('Billing', 'Inner transition to Templates preserves counts (0, 0, 0)', billingCounts['Invoices']?.count === 0 && billingCounts['Templates']?.count === 0 && billingCounts['Archive']?.count === 0, `Found: ${JSON.stringify(billingCounts)}`);

    // Transition to Archive tab:
    await page.click('.module-tab-link:has-text("Archive")');
    await page.waitForTimeout(500);
    billingCounts = await getTabCounts(page);
    record('Billing', 'Inner transition to Archive preserves counts (0, 0, 0)', billingCounts['Invoices']?.count === 0 && billingCounts['Templates']?.count === 0 && billingCounts['Archive']?.count === 0, `Found: ${JSON.stringify(billingCounts)}`);

    // Hard refresh on deep link #billing?tab=archive:
    await page.goto(`${BASE_URL}/#billing?tab=archive`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.module-tab-nav', { timeout: 10000 });
    billingCounts = await waitForTabCounts(page, ['Invoices', 'Templates', 'Archive']);
    record('Billing', 'Hard refresh at #billing?tab=archive retains accurate counts (0, 0, 0)', billingCounts['Invoices']?.count === 0 && billingCounts['Templates']?.count === 0 && billingCounts['Archive']?.count === 0, `Found: ${JSON.stringify(billingCounts)}`);

    // ─── 4. DISBURSEMENT MODULE ──────────────────────────
    console.log('\n--- Testing Disbursement Module ---');
    await page.click('a[data-module="disbursement"]');
    await page.waitForSelector('.module-tab-nav', { timeout: 10000 });

    let disbCounts = await waitForTabCounts(page, ['Disbursements', 'Templates', 'Archive']);
    record('Disbursement', 'First visit: Disbursements count is accurate (0)', disbCounts['Disbursements']?.count === 0, `Found: ${disbCounts['Disbursements']?.count}`);
    record('Disbursement', 'First visit: Templates count is 0', disbCounts['Templates']?.count === 0, `Found: ${disbCounts['Templates']?.count}`);
    record('Disbursement', 'First visit: Archive count is 0', disbCounts['Archive']?.count === 0, `Found: ${disbCounts['Archive']?.count}`);

    // Transition to Templates tab:
    await page.click('.module-tab-link:has-text("Templates")');
    await page.waitForTimeout(500);
    disbCounts = await getTabCounts(page);
    record('Disbursement', 'Inner transition to Templates preserves counts (0, 0, 0)', disbCounts['Disbursements']?.count === 0 && disbCounts['Templates']?.count === 0 && disbCounts['Archive']?.count === 0, `Found: ${JSON.stringify(disbCounts)}`);

    // Transition to Archive tab:
    await page.click('.module-tab-link:has-text("Archive")');
    await page.waitForTimeout(500);
    disbCounts = await getTabCounts(page);
    record('Disbursement', 'Inner transition to Archive preserves counts (0, 0, 0)', disbCounts['Disbursements']?.count === 0 && disbCounts['Templates']?.count === 0 && disbCounts['Archive']?.count === 0, `Found: ${JSON.stringify(disbCounts)}`);

    // Hard refresh on deep link #disbursement?tab=archive:
    await page.goto(`${BASE_URL}/#disbursement?tab=archive`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.module-tab-nav', { timeout: 10000 });
    disbCounts = await waitForTabCounts(page, ['Disbursements', 'Templates', 'Archive']);
    record('Disbursement', 'Hard refresh at #disbursement?tab=archive retains accurate counts (0, 0, 0)', disbCounts['Disbursements']?.count === 0 && disbCounts['Templates']?.count === 0 && disbCounts['Archive']?.count === 0, `Found: ${JSON.stringify(disbCounts)}`);

    // ─── 5. TRANSMITTAL MODULE ───────────────────────────
    console.log('\n--- Testing Transmittal Module ---');
    await page.click('a[data-module="transmittal"]');
    await page.waitForSelector('.module-tab-nav', { timeout: 10000 });

    let transCounts = await waitForTabCounts(page, ['Transmittals', 'Archive']);
    record('Transmittal', 'First visit: Transmittals count is accurate (0)', transCounts['Transmittals']?.count === 0, `Found: ${transCounts['Transmittals']?.count}`);
    record('Transmittal', 'First visit: Archive count is 0', transCounts['Archive']?.count === 0, `Found: ${transCounts['Archive']?.count}`);

    // Transition to Archive tab:
    await page.click('.module-tab-link:has-text("Archive")');
    await page.waitForTimeout(500);
    transCounts = await getTabCounts(page);
    record('Transmittal', 'Inner transition to Archive preserves counts (0, 0)', transCounts['Transmittals']?.count === 0 && transCounts['Archive']?.count === 0, `Found: ${JSON.stringify(transCounts)}`);

    // Hard refresh on deep link #transmittal?tab=archive:
    await page.goto(`${BASE_URL}/#transmittal?tab=archive`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.module-tab-nav', { timeout: 10000 });
    transCounts = await waitForTabCounts(page, ['Transmittals', 'Archive']);
    record('Transmittal', 'Hard refresh at #transmittal?tab=archive retains accurate counts (0, 0)', transCounts['Transmittals']?.count === 0 && transCounts['Archive']?.count === 0, `Found: ${JSON.stringify(transCounts)}`);

    // Summary
    console.log('\n====================================================');
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    console.log(`RESULTS: ${passed}/${total} passed (${failed} failed)`);
    console.log('====================================================');

    if (failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Fatal error during test run:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runTests();
