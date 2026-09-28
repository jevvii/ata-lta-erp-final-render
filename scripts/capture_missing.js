const { chromium } = require('../erp_prototype/node_modules/playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('https://ata-lta-erp-spa-staging.onrender.com');
  await page.fill('#email', 'lorein@ata-lta.ph');
  await page.fill('#password', 'Password@123');
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 25000 });
  await page.waitForTimeout(3000);

  // Capture Entity Switcher open
  const entityPill = await page.$('.entity-pill select, #entity-switcher');
  if (entityPill) {
    await page.evaluate(() => {
      const pill = document.querySelector('.entity-pill');
      if (pill) pill.style.outline = '3px solid #2563EB';
    });
    await page.screenshot({ path: path.join(__dirname, '../docs/screenshots/04_entity_switcher.png') });
    console.log('📸 Saved: 04_entity_switcher.png');
  }

  // Fetch WRs
  const wrList = await page.evaluate(async () => {
    const res = await window.apiClient.workRequests.list();
    return res.data ? res.data.map(w => ({ id: w.id, title: w.title })) : [];
  });
  console.log('Work Requests from API:', wrList);

  if (wrList.length > 0) {
    const firstId = wrList[0].id;
    console.log('Navigating to detail of:', firstId);
    await page.goto('https://ata-lta-erp-spa-staging.onrender.com/#operations/detail/' + firstId);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(__dirname, '../docs/screenshots/09_work_request_detail_phases.png') });
    console.log('📸 Saved: 09_work_request_detail_phases.png');

    // Click + Add Task
    const addTaskBtn = await page.$('button:has-text("+ Add Task"), button:has-text("Add Task")');
    if (addTaskBtn) {
      await addTaskBtn.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(__dirname, '../docs/screenshots/10_add_task_template_modal.png') });
      console.log('📸 Saved: 10_add_task_template_modal.png');
    }
  }

  await browser.close();
  console.log('Done capturing missing screenshots!');
})();
