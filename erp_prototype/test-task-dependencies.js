const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8089';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lorein@ata-lta.ph';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Password@123';

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

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on('dialog', async dialog => {
      console.log('Dialog detected:', dialog.type(), dialog.message());
      await dialog.dismiss();
    });

    console.log('Logging in as Admin/Manager:', ADMIN_EMAIL);
    await page.goto(BASE_URL);
    await page.waitForSelector('#email', { timeout: 30000 });
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 30000 });

    console.log('\n--- TEST 1: Work Request Creation Form - Initial Empty Rows ---');
    await page.goto(`${BASE_URL}#operations/form/new`);
    await page.waitForSelector('#wr-form, form.work-request-form', { timeout: 15000 });

    // Verify 2 task rows exist by default
    const rows = await page.locator('.wr-task-row');
    const rowCount = await rows.count();
    record('Initial form renders 2 task rows', rowCount === 2, `Count: ${rowCount}`);

    // Verify both task title inputs are empty
    const title0 = await rows.nth(0).locator('.task-title-input').inputValue();
    const title1 = await rows.nth(1).locator('.task-title-input').inputValue();
    record('Initial task titles are empty', title0 === '' && title1 === '');

    // Check Row 2 dependency dropdown
    const predBtn1 = rows.nth(1).locator('.task-pred .multi-select-btn');
    const predMenu1 = rows.nth(1).locator('.task-pred .multi-select-menu');

    const predBtn1Text = await predBtn1.textContent();
    record('Row 2 dependency button text is default', predBtn1Text.includes('— No dependency —'), `Got: "${predBtn1Text.trim()}"`);

    await predBtn1.click();
    await page.waitForTimeout(300);

    const optionsText1 = await predMenu1.innerText();
    const hasPhantomTask1 = optionsText1.includes('Task 1');
    const hasPhantomTask2 = optionsText1.includes('Task 2');
    const hasPhantomAll = optionsText1.includes('All Tasks (*)');
    const hasEmptyNotice = optionsText1.includes('No named tasks available');

    record('Empty task container is NOT in dependencies', !hasPhantomTask1 && !hasPhantomTask2, `Menu text: "${optionsText1.trim()}"`);
    record('All Tasks (*) is NOT present when no named tasks exist', !hasPhantomAll);
    record('Empty notice is shown when no named tasks exist', hasEmptyNotice);

    // Close menu
    await predBtn1.click();
    await page.waitForTimeout(200);

    console.log('\n--- TEST 2: Dynamic Dependency Updates on Title Input ---');
    // Type into Row 1 title
    const titleInput0 = rows.nth(0).locator('.task-title-input');
    await titleInput0.fill('Draft Financial Report');
    await page.waitForTimeout(300);

    // Open Row 2 dependency menu
    await predBtn1.click();
    await page.waitForTimeout(300);
    const updatedOptionsText1 = await predMenu1.innerText();
    record('Named task appears in Row 2 dependencies', updatedOptionsText1.includes('Draft Financial Report'), `Menu: "${updatedOptionsText1.trim()}"`);

    // Check the named task checkbox in Row 2
    const draftReportCheckbox = predMenu1.locator('input[type="checkbox"]').last();
    await draftReportCheckbox.check();
    await page.waitForTimeout(300);

    const predBtn1Updated = await predBtn1.textContent();
    record('Row 2 button label updates to selected task title', predBtn1Updated.includes('Draft Financial Report'), `Button: "${predBtn1Updated.trim()}"`);

    // Close menu
    await predBtn1.click();
    await page.waitForTimeout(200);

    console.log('\n--- TEST 3: Clearing Task Title Prunes Stale Dependencies ---');
    // Clear Row 1 title
    await titleInput0.fill('');
    await page.waitForTimeout(300);

    const predBtn1AfterClear = await predBtn1.textContent();
    record('Row 2 button resets when predecessor title is cleared', predBtn1AfterClear.includes('— No dependency —'), `Button: "${predBtn1AfterClear.trim()}"`);

    await predBtn1.click();
    await page.waitForTimeout(300);
    const menuAfterClear = await predMenu1.innerText();
    record('Row 2 menu reverts to no named tasks available', menuAfterClear.includes('No named tasks available'));
    await predBtn1.click();
    await page.waitForTimeout(200);

    console.log('\n--- TEST 4: Multiple Named Tasks & Row Addition ---');
    await titleInput0.fill('Phase 1: Discovery');
    const titleInput1 = rows.nth(1).locator('.task-title-input');
    await titleInput1.fill('Phase 2: Execution');
    await page.waitForTimeout(300);

    // Add a 3rd task
    const addTaskBtn = page.locator('button[data-role="add-task"], .notion-add-line-item');
    await addTaskBtn.click();
    await page.waitForTimeout(500);

    const rowsAfterAdd = page.locator('.wr-task-row');
    record('3rd task row added', (await rowsAfterAdd.count()) === 3);

    const predBtn2 = rowsAfterAdd.nth(2).locator('.task-pred .multi-select-btn');
    const predMenu2 = rowsAfterAdd.nth(2).locator('.task-pred .multi-select-menu');
    await predBtn2.click();
    await page.waitForTimeout(300);

    const menu2Text = await predMenu2.innerText();
    record('Row 3 sees Phase 1 in dependency list', menu2Text.includes('Phase 1: Discovery'));
    record('Row 3 sees Phase 2 in dependency list', menu2Text.includes('Phase 2: Execution'));
    record('Row 3 sees All Tasks (*)', menu2Text.includes('All Tasks (*)'));

    // Check All Tasks (*)
    const allCheckbox = predMenu2.locator('input[value="*"]');
    await allCheckbox.check();
    await page.waitForTimeout(200);

    const predBtn2Text = await predBtn2.textContent();
    record('Row 3 button updates to All Tasks (*)', predBtn2Text.includes('All Tasks (*)'), `Button: "${predBtn2Text.trim()}"`);
    await predBtn2.click();
    await page.waitForTimeout(200);

    console.log('\n--- TEST 5: Light Validation (Inline Highlight + Toast, NO Modal) ---');
    // Fill WR title and required form fields
    const wrTitleInput = page.locator('input[name="title"].notion-title-input');
    if (await wrTitleInput.count() > 0) {
      await wrTitleInput.fill('E2E Validation Test Work Request');
    }

    // Select client if dropdown exists
    const clientSelect = page.locator('select[name="clientId"]');
    if (await clientSelect.count() > 0) {
      const firstVal = await clientSelect.locator('option').nth(1).getAttribute('value');
      if (firstVal) await clientSelect.selectOption(firstVal);
    }

    // Due date
    const dueDateInput = page.locator('input[name="dueDate"]');
    if (await dueDateInput.count() > 0) {
      await dueDateInput.fill('2026-10-31');
    }

    // Notice: Row 1 & Row 2 have titles, but NO assignees!
    // Row 3 has dependencies, but NO title!
    const submitBtn = page.locator('button[form="wr-form"], button:has-text("Submit Request")').first();
    await submitBtn.click();
    await page.waitForTimeout(600);

    // 1. Check that NO modal dialog is opened
    const modalVisible = await page.evaluate(() => {
      const modal = document.querySelector('.modal.show, .swal2-container, #message-modal.show, .custom-modal.show');
      return !!modal && window.getComputedStyle(modal).display !== 'none';
    });
    record('NO modal dialog opened on validation error', !modalVisible);

    // 2. Check that light toast appeared
    const toast = page.locator('.utils-toast-error, .utils-toast');
    const toastCount = await toast.count();
    const toastText = toastCount > 0 ? await toast.first().innerText() : '';
    record('Light toast validation error appeared', toastCount > 0, `Toast: "${toastText.trim()}"`);

    // 3. Check that input-error class is applied to invalid field
    const errorInputs = page.locator('.input-error');
    const errorCount = await errorInputs.count();
    record('Invalid field has input-error highlight', errorCount > 0, `Highlighted inputs: ${errorCount}`);

    // Row 3 was missing a title: let's verify title input for row 3 has input-error or row 1 assignee has it
    const titleInput2 = rowsAfterAdd.nth(2).locator('.task-title-input');
    await titleInput2.fill('Phase 3: Delivery');
    await page.waitForTimeout(200);

    const hasErrorClass = await titleInput2.evaluate(el => el.classList.contains('input-error'));
    record('Typing clears input-error class on title input', !hasErrorClass);

    console.log('\n══════════════════════════════════════════════════════════════');
    const passedCount = results.filter(r => r.passed).length;
    console.log(`Results: ${passedCount}/${results.length} tests passed.`);
    if (passedCount < results.length) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
