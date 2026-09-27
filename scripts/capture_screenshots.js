const { chromium } = require('../erp_prototype/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'https://ata-lta-erp-spa-staging.onrender.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lorein@ata-lta.ph';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Password@123';
const STAFF_EMAIL = process.env.STAFF_EMAIL || 'rea@ata-lta.ph';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'Password@123';

const OUT_DIR = path.resolve(__dirname, '../docs/screenshots');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function snap(page, filename, delayMs = 600) {
  if (delayMs > 0) await page.waitForTimeout(delayMs);
  const target = path.join(OUT_DIR, filename);
  await page.screenshot({ path: target, fullPage: false });
  console.log(`📸 Saved: ${filename}`);
}

async function closePanes(page) {
  await page.evaluate(() => {
    if (typeof Utils !== 'undefined' && Utils.closePane) {
      try { Utils.closePane(); } catch (e) {}
    }
    const pane = document.getElementById('global-side-pane');
    if (pane) {
      pane.classList.remove('open');
      pane.setAttribute('aria-hidden', 'true');
    }
    const b = document.getElementById('side-pane-backdrop');
    if (b) b.remove();
    const modal = document.querySelector('.modal-overlay');
    if (modal) modal.remove();
  });
  await page.waitForTimeout(300);
}

async function nav(page, hash) {
  await closePanes(page);
  await page.evaluate(async (targetHash) => {
    window.location.hash = targetHash;
    if (typeof App !== 'undefined' && App.handleRoute) {
      await App.handleRoute();
    }
  }, hash);
  await page.waitForTimeout(1000);
}

(async () => {
  console.log('Starting comprehensive screenshot capture against:', BASE_URL);
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();

  try {
    // 1. Login Page
    console.log('1. Capturing Login Page...');
    await page.goto(BASE_URL);
    await page.waitForSelector('#email', { timeout: 15000 });
    await snap(page, '01_login_screen.png', 500);

    // 2. Perform Login as Admin
    console.log('2. Logging in as Admin:', ADMIN_EMAIL);
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await snap(page, '02_login_credentials.png', 300);
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 25000 });
    console.log('Admin login successful!');

    // 3. Dashboard Overview & Entity Switcher
    console.log('3. Capturing Dashboard & Entity Switcher...');
    await snap(page, '03_dashboard_overview.png', 1000);

    // Open Entity Dropdown
    const entityBtn = await page.$('.entity-selector button, #active-entity-btn, button:has-text("ATA"), button:has-text("ALL")');
    if (entityBtn) {
      await entityBtn.click();
      await snap(page, '04_entity_switcher_dropdown.png', 400);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // 4. Clients Module
    console.log('4. Capturing Clients Directory...');
    await nav(page, '#clients');
    await snap(page, '05_clients_directory.png', 800);

    // Open Client Form
    console.log('Opening Client Form...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Client'));
      if (btn) btn.click();
      else window.location.hash = '#clients/form/new';
    });
    await page.waitForTimeout(800);
    await snap(page, '06_client_form_side_peek.png', 500);
    await closePanes(page);

    // 5. Operations / Work Requests Module
    console.log('5. Capturing Operations & Work Requests...');
    await nav(page, '#operations');
    await snap(page, '07_operations_kanban.png', 800);

    // Open "+ New Work Request"
    console.log('Opening New Work Request Form...');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Work Request'));
      if (btn) btn.click();
      else window.location.hash = '#operations/form/new';
    });
    await page.waitForTimeout(800);
    await snap(page, '08_new_work_request_form.png', 500);
    await closePanes(page);

    // Open First Work Request Detail
    console.log('Opening Work Request Detail...');
    const wrLinks = await page.$$('.jira-table tbody tr, .kanban-card');
    if (wrLinks.length > 0) {
      await wrLinks[0].click();
      await page.waitForTimeout(1200);
      await snap(page, '09_work_request_detail_phases.png', 600);

      // Open "+ Add Task"
      const addTaskBtn = await page.$('button:has-text("+ Add Task"), button:has-text("Add Task")');
      if (addTaskBtn) {
        await addTaskBtn.click();
        await page.waitForTimeout(800);
        await snap(page, '10_add_task_template_modal.png', 500);
        await closePanes(page);
      }
    }

    // 6. Admin Task Templates Management Tab
    console.log('6. Capturing Admin Task Templates...');
    await nav(page, '#operations?tab=task-templates');
    await snap(page, '11_admin_task_templates_tab.png', 800);

    // Open Create Task Template Form
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Template'));
      if (btn) btn.click();
      else window.location.hash = '#operations/taskTemplateForm/new';
    });
    await page.waitForTimeout(800);
    await snap(page, '12_task_template_editor.png', 500);
    await closePanes(page);

    // 7. Invoicing & Billing Module
    console.log('7. Capturing Invoicing & Billing...');
    await nav(page, '#billing');
    await snap(page, '13_billing_invoices_list.png', 800);

    // Open New Invoice Form
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Invoice'));
      if (btn) btn.click();
      else window.location.hash = '#billing/form/new';
    });
    await page.waitForTimeout(800);
    await snap(page, '14_new_invoice_form.png', 500);
    await closePanes(page);

    // AR Aging Tab
    console.log('Capturing AR Aging...');
    await nav(page, '#billing?tab=aging');
    await snap(page, '15_ar_aging_buckets.png', 800);

    // Retainer Templates Tab
    console.log('Capturing Retainer Templates...');
    await nav(page, '#billing?tab=templates');
    await snap(page, '16_retainer_billing_templates.png', 800);

    // 8. Disbursements Module
    console.log('8. Capturing Disbursements & AP...');
    await nav(page, '#disbursement');
    await snap(page, '17_disbursements_list.png', 800);

    // Open New Disbursement Form
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Disbursement'));
      if (btn) btn.click();
      else window.location.hash = '#disbursement/form/new';
    });
    await page.waitForTimeout(800);
    await snap(page, '18_new_disbursement_form.png', 500);
    await closePanes(page);

    // 9. Document Custody (DMS)
    console.log('9. Capturing Document Management (DMS)...');
    await nav(page, '#dms');
    await snap(page, '19_dms_document_repository.png', 800);

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Document') || b.textContent.includes('Upload'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(800);
    await snap(page, '20_dms_upload_modal.png', 500);
    await closePanes(page);

    // 10. Transmittals Module
    console.log('10. Capturing Courier Transmittals...');
    await nav(page, '#transmittal');
    await snap(page, '21_transmittals_list.png', 800);

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Transmittal'));
      if (btn) btn.click();
      else window.location.hash = '#transmittal/form/new';
    });
    await page.waitForTimeout(800);
    await snap(page, '22_new_transmittal_form.png', 500);
    await closePanes(page);

    // 11. Operations Requests & Pending Approvals
    console.log('11. Capturing Approvals & Operations Requests...');
    await nav(page, '#admin/pending-approvals');
    await snap(page, '23_pending_approvals_four_eyes.png', 800);

    await nav(page, '#admin/my-requests');
    await snap(page, '24_operations_requests_queue.png', 800);

    // 12. User Management & Audit Logs
    console.log('12. Capturing User Management & Audit...');
    await nav(page, '#admin/users');
    await snap(page, '25_user_management_accounts.png', 800);

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('User'));
      if (btn) btn.click();
      else window.location.hash = '#admin/users/form/new';
    });
    await page.waitForTimeout(800);
    await snap(page, '26_user_create_edit_form.png', 500);
    await closePanes(page);

    await nav(page, '#admin/audit');
    await snap(page, '27_security_audit_logs.png', 800);

    // 13. Reports & Analytics
    console.log('13. Capturing Reports Module...');
    await nav(page, '#reports');
    await snap(page, '28_reports_and_analytics.png', 800);

    // 14. Operations Staff View
    console.log('14. Capturing Operations Staff View...');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.goto(BASE_URL);
    await page.waitForSelector('#email', { timeout: 15000 });
    await page.fill('#email', STAFF_EMAIL);
    await page.fill('#password', STAFF_PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 25000 });
    console.log('Staff logged in successfully!');

    await snap(page, '29_staff_dashboard.png', 1000);
    await nav(page, '#operations');
    await snap(page, '30_staff_operations_board.png', 800);

    console.log('✅ ALL SCREENSHOTS SUCCESSFULLY CAPTURED!');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    await browser.close();
  }
})();
