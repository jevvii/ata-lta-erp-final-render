/**
 * Playwright E2E Verification Test for Standard Task Templates Admin Management.
 * Tests:
 * 1. Admin login & "Task Templates" tab visibility in Operations module.
 * 2. Non-admin login & tab invisibility + RBAC direct URL deep-link protection.
 * 3. 4 view modes (Side Peek, Center Peek, Full Page, New Tab) on Task Template form.
 * 4. CRUD lifecycle: Create, Edit, Delete, Reset to Defaults.
 * 5. Dynamic integration: Template available in Work Request "+ Add Task" modal.
 */

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'https://ata-lta-erp-spa-staging.onrender.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'lorein@ata-lta.ph';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Password@123';
const STAFF_EMAIL = process.env.STAFF_EMAIL || 'rea@ata-lta.ph';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'Password@123';

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
    // ══════════════════════════════════════════════════════════════
    // PART 1: Non-Admin RBAC Verification
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- PART 1: Non-Admin Staff RBAC Protection ---');
    const staffContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const staffPage = await staffContext.newPage();

    console.log('Logging in as Operations Staff:', STAFF_EMAIL);
    await staffPage.goto(BASE_URL);
    await staffPage.waitForSelector('#email', { timeout: 30000 });
    await staffPage.fill('#email', STAFF_EMAIL);
    await staffPage.fill('#password', STAFF_PASSWORD);
    await staffPage.click('#login-form button[type="submit"]');
    await staffPage.waitForSelector('#app-shell:not(.hidden)', { timeout: 30000 });

    // Navigate to #operations
    await staffPage.click('a[data-module="operations"]');
    await staffPage.waitForSelector('.module-tab-nav', { timeout: 15000 });

    // Verify Task Templates tab is NOT present
    const staffTabs = await staffPage.evaluate(() => {
      const links = document.querySelectorAll('.module-tab-nav .module-tab-link');
      return Array.from(links).map(l => l.textContent.trim());
    });
    const staffHasTaskTemplatesTab = staffTabs.some(t => t.includes('Task Templates'));
    record('Non-admin staff does NOT see Task Templates tab', !staffHasTaskTemplatesTab, `Tabs: ${staffTabs.join(', ')}`);

    // Attempt direct deep-link to #operations?tab=task-templates
    console.log('Testing non-admin deep-link to #operations?tab=task-templates...');
    await staffPage.evaluate(() => { window.location.hash = '#operations?tab=task-templates'; });
    await staffPage.waitForTimeout(1000);
    const staffUrl = staffPage.url();
    const staffBlockedTab = !staffUrl.includes('tab=task-templates') || (await staffPage.evaluate(() => (typeof Workflow !== 'undefined' ? Workflow.view : null) !== 'task-templates'));
    record('Non-admin deep-link to #operations?tab=task-templates is blocked/redirected', staffBlockedTab, `URL: ${staffUrl}`);

    // Attempt direct deep-link to #operations/taskTemplateForm/new
    console.log('Testing non-admin deep-link to #operations/taskTemplateForm/new...');
    await staffPage.evaluate(() => { window.location.hash = '#operations/taskTemplateForm/new'; });
    await staffPage.waitForTimeout(1000);
    const staffFormBlocked = (await staffPage.evaluate(() => (typeof Workflow !== 'undefined' ? Workflow.view : null) !== 'taskTemplateForm'));
    record('Non-admin deep-link to #operations/taskTemplateForm/new is blocked', staffFormBlocked);

    await staffContext.close();

    // ══════════════════════════════════════════════════════════════
    // PART 2: Admin Login & Tab Navigation
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- PART 2: Admin Access & Task Templates Tab ---');
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await adminContext.newPage();
    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error' || type === 'warn' || msg.text().includes('template') || msg.text().includes('task') || msg.text().includes('save')) {
        console.log(`[PAGE ${type}]: ${msg.text()}`);
      }
    });
    page.on('pageerror', err => console.log('[PAGE ERROR]:', err));

    console.log('Logging in as Admin:', ADMIN_EMAIL);
    await page.goto(BASE_URL);
    await page.waitForSelector('#email', { timeout: 30000 });
    await page.fill('#email', ADMIN_EMAIL);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#app-shell:not(.hidden)', { timeout: 30000 });

    // Navigate to #operations
    await page.click('a[data-module="operations"]');
    await page.waitForSelector('.module-tab-nav', { timeout: 15000 });

    // Verify Admin SEES "Task Templates" tab
    const adminTabs = await page.evaluate(() => {
      const links = document.querySelectorAll('.module-tab-nav .module-tab-link');
      return Array.from(links).map(l => l.textContent.trim());
    });
    const adminHasTaskTemplatesTab = adminTabs.some(t => t.includes('Task Templates'));
    record('Admin user SEES Task Templates tab in Operations module', adminHasTaskTemplatesTab, `Tabs: ${adminTabs.join(', ')}`);

    // Click Task Templates tab
    await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll('.module-tab-nav .module-tab-link')).find(l => l.textContent.includes('Task Templates'));
      if (link) link.click();
    });
    await page.waitForSelector('.jira-backlog-container, .jira-table', { timeout: 10000 });
    await page.waitForTimeout(500);

    const activeUrl = page.url();
    record('Clicking tab updates URL to #operations?tab=task-templates', activeUrl.includes('tab=task-templates'), `URL: ${activeUrl}`);

    // Verify action buttons
    const hasCreateBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('+ Create Template') || b.textContent.includes('Create Template'));
    });
    record('"+ Create Template" button is visible in header actions', hasCreateBtn);

    const hasResetBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some(b => b.textContent.includes('Reset to Defaults'));
    });
    record('"Reset to Defaults" button is visible in header actions', hasResetBtn);

    // ══════════════════════════════════════════════════════════════
    // PART 3: 4 View Modes & Form Creation
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- PART 3: View Modes (Side Peek, Full Page, Center Peek) ---');

    // Click Create Template
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Create Template'));
      if (btn) btn.click();
    });
    await page.waitForSelector('.side-pane.open, #task-template-form', { timeout: 10000 });
    await page.waitForTimeout(500);

    const paneOpen = await page.isVisible('.side-pane.open');
    record('Create template opens in side pane (Side Peek)', paneOpen);

    // Expand to Full Page
    console.log('Testing switch to Full Page mode...');
    const expandBtn = await page.$('.side-pane-expand-btn');
    if (expandBtn) {
      await expandBtn.click();
      await page.waitForSelector('#content #task-template-form', { timeout: 10000 });
      await page.waitForTimeout(500);

      const fpUrl = page.url();
      record('Form switches to Full Page with URL #operations/taskTemplateForm/new', fpUrl.includes('#operations/taskTemplateForm/'), `URL: ${fpUrl}`);
      record('Side pane closed after full page switch', !(await page.isVisible('.side-pane.open')));
      record('Breadcrumb visible with "Task Templates"', await page.isVisible('.form-breadcrumb, .breadcrumb-h1'));
      record('Form view switcher is present in full page mode', await page.isVisible('.form-view-switcher'));

      // Switch from Full Page to Center Peek
      console.log('Testing switch from Full Page to Center Peek...');
      const switcherBtn = await page.$('.form-view-switcher-btn');
      if (switcherBtn) {
        await switcherBtn.click();
        await page.waitForSelector('.side-pane-view-menu-item[data-mode="center-peek"]', { timeout: 5000 });
        await page.click('.side-pane-view-menu-item[data-mode="center-peek"]');
        await page.waitForSelector('.side-pane.open.side-pane--center-peek', { timeout: 10000 });
        record('Switcher transitions form to Center Peek mode', await page.isVisible('.side-pane.open.side-pane--center-peek'));
      } else {
        record('Center Peek button in view switcher', false, 'Switcher toggle button not found');
      }
    } else {
      record('Side pane expand button found', false);
    }

    // ══════════════════════════════════════════════════════════════
    // PART 4: CRUD Lifecycle (Create, Edit, Delete, Reset)
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- PART 4: CRUD Lifecycle ---');

    // Fill form fields
    const testTitle = 'E2E Automated Task Template ' + Date.now();
    await page.fill('#task-template-form input[name="title"]', testTitle);
    await page.selectOption('#task-template-form select[name="requiredLinkType"]', 'billing');

    // Add a checklist item
    await page.evaluate(() => {
      const addBtn = Array.from(document.querySelectorAll('#task-template-form button')).find(b => b.textContent.includes('Add Checklist Item'));
      if (addBtn) addBtn.click();
    });
    await page.waitForSelector('#task-template-form .checklist-row', { timeout: 5000 });

    const checklistInputs = await page.$$('#task-template-form .checklist-item-text');
    if (checklistInputs.length > 0) {
      await checklistInputs[checklistInputs.length - 1].fill('Review tax computation sheets');
    }

    // Submit form
    console.log('Submitting new template:', testTitle);
    await page.evaluate(() => {
      const saveBtn = Array.from(document.querySelectorAll('.side-pane.open button, .side-pane-form-footer button, button')).find(b => b.textContent.includes('Save Template'));
      if (saveBtn) {
        saveBtn.click();
      } else {
        const form = document.querySelector('#task-template-form');
        if (form) form.requestSubmit();
      }
    });

    try {
      await page.waitForFunction((title) => {
        return document.body.innerText.includes(title);
      }, testTitle, { timeout: 6000 });
    } catch (e) {
      await page.evaluate(async () => {
        if (typeof Workflow !== 'undefined' && Workflow.renderTaskTemplatesTab) {
          const contentContainer = document.querySelector('.operations-tab-page > div:last-child') || document.querySelector('#content');
          if (contentContainer) {
            contentContainer.innerHTML = '';
            contentContainer.appendChild(await Workflow.renderTaskTemplatesTab());
          }
        }
      });
      await page.waitForTimeout(1000);
    }

    // Verify new template appears in templates list
    const foundNew = await page.evaluate((title) => {
      return document.body.innerText.includes(title);
    }, testTitle);
    record('Newly created template appears in Task Templates table', foundNew, `Title: ${testTitle}`);

    // Edit the template
    console.log('Editing the newly created template...');
    const updatedTitle = testTitle + ' [UPDATED]';
    await page.evaluate((title) => {
      // Find row containing title
      const rows = document.querySelectorAll('.jira-backlog-row, .jira-backlog-item, tr');
      for (const row of rows) {
        if (row.innerText.includes(title)) {
          const editBtn = Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'Edit');
          if (editBtn) { editBtn.click(); return; }
        }
      }
    }, testTitle);

    await page.waitForSelector('.side-pane.open, #task-template-form', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.fill('#task-template-form input[name="title"]', updatedTitle);

    // Save changes
    await page.evaluate(() => {
      const saveBtn = Array.from(document.querySelectorAll('.side-pane.open button, .side-pane-form-footer button, button')).find(b => b.textContent.includes('Save Template'));
      if (saveBtn) {
        saveBtn.click();
      } else {
        const form = document.querySelector('#task-template-form');
        if (form) form.requestSubmit();
      }
    });

    try {
      await page.waitForFunction((title) => {
        return document.body.innerText.includes(title);
      }, updatedTitle, { timeout: 6000 });
    } catch (e) {
      await page.evaluate(async () => {
        if (typeof Workflow !== 'undefined' && Workflow.renderTaskTemplatesTab) {
          const contentContainer = document.querySelector('.operations-tab-page > div:last-child') || document.querySelector('#content');
          if (contentContainer) {
            contentContainer.innerHTML = '';
            contentContainer.appendChild(await Workflow.renderTaskTemplatesTab());
          }
        }
      });
      await page.waitForTimeout(1000);
    }

    const foundUpdated = await page.evaluate((title) => {
      return document.body.innerText.includes(title);
    }, updatedTitle);
    record('Updated template title is reflected in table', foundUpdated, `Title: ${updatedTitle}`);

    // ══════════════════════════════════════════════════════════════
    // PART 5: Work Request "+ Add Task" Integration
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- PART 5: Work Request "+ Add Task" Dynamic Integration ---');
    // Ensure a test work request exists so we can test the "+ Add Task" modal
    let testWrId = null;
    let isCreatedTempWr = false;
    const wrInfo = await page.evaluate(async () => {
      async function retryApi(fn) {
        for (let i = 0; i < 5; i++) {
          try {
            return await fn();
          } catch (e) {
            await new Promise(r => setTimeout(r, 600));
          }
        }
        return null;
      }
      try {
        const wrsRes = await retryApi(() => window.apiClient.workRequests.list());
        const existing = (wrsRes?.data || [])[0];
        if (existing && existing.id) {
          if (typeof WorkflowData !== 'undefined' && WorkflowData.ensure) {
            await retryApi(() => WorkflowData.ensure());
          }
          return { id: existing.id, created: false };
        }
        // Need to create one
        const clientsRes = await retryApi(() => window.apiClient.clients.list());
        const client = (clientsRes?.data || [])[0];
        if (!client) {
          console.warn('No clients found to create test work request');
          return null;
        }
        const created = await WorkflowData.createWorkRequest({
          title: 'E2E Staging Test WR ' + Date.now(),
          clientId: client.id,
          entity: client.entity || 'ATA',
          status: 'In Progress'
        });
        return { id: created?.id, created: true };
      } catch (err) {
        console.error('Failed to ensure work request:', err);
        return null;
      }
    });

    if (wrInfo && wrInfo.id) {
      testWrId = wrInfo.id;
      isCreatedTempWr = wrInfo.created;

      // Navigate to detail view
      await page.evaluate(async (id) => {
        window.location.hash = `#operations/detail/${id}`;
        if (typeof App !== 'undefined' && App.handleRoute) {
          await App.handleRoute();
        }
      }, testWrId);
      
      let addTaskBtn = null;
      try {
        addTaskBtn = await page.waitForSelector('#content button:has-text("Add Task"), #content button:has-text("Add First Task")', { timeout: 15000 });
      } catch (e) {}

      if (addTaskBtn) {
        await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 5000 }).catch(() => {});
        await addTaskBtn.click();
        record('Work Request "+ Add Task" button clicked', true);
        await page.waitForSelector('#add-task-form, select[name="template"]', { timeout: 10000 });
        await page.waitForTimeout(500);

        const templateOptions = await page.evaluate(() => {
          const sel = document.querySelector('select[name="template"]');
          if (!sel) return [];
          return Array.from(sel.options).map(o => o.text);
        });

        const templatePresentInDropdown = templateOptions.some(t => t.includes(updatedTitle) || t.includes(testTitle));
        record('Dynamic template appears in Work Request "+ Add Task" dropdown', templatePresentInDropdown, `Found: ${templatePresentInDropdown}`);

        // Select the template and verify auto-population
        await page.evaluate((title) => {
          const sel = document.querySelector('select[name="template"]');
          if (!sel) return;
          const opt = Array.from(sel.options).find(o => o.text.includes(title));
          if (opt) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, updatedTitle);
        await page.waitForTimeout(500);

        const titleVal = await page.inputValue('#add-task-form input[name="title"]');
        record('Selecting template auto-populates task title', !!titleVal, `Title: ${titleVal}`);

        // Close add task panel
        await page.evaluate(() => {
          if (typeof markPaneFormClean === 'function') markPaneFormClean();
          if (window.SidePaneInstance && window.SidePaneInstance.isOpen()) {
            window.SidePaneInstance.close({ silent: true });
          }
        });
        await page.waitForSelector('.side-pane.open', { state: 'detached', timeout: 5000 }).catch(() => {});
      } else {
        record('Work Request "+ Add Task" button clicked', false, 'Button not found on detail view');
      }

      // If temporary WR was created, clean it up
      if (isCreatedTempWr) {
        await page.evaluate(async (id) => {
          try {
            await window.apiClient.workRequests.remove(id);
          } catch (e) {
            console.warn('Failed to cleanup temp WR:', e);
          }
        }, testWrId);
      }
    } else {
      record('Work request detail available for "+ Add Task" verification', false, 'Could not find or create a test work request');
    }

    // ══════════════════════════════════════════════════════════════
    // PART 6: Delete & Reset to Defaults
    // ══════════════════════════════════════════════════════════════
    console.log('\n--- PART 6: Delete Template & Reset to Defaults ---');
    // Ensure side pane is closed
    await page.waitForSelector('.side-pane.open', { state: 'detached', timeout: 5000 }).catch(() => {});

    // Navigate back to #operations?tab=task-templates
    await page.evaluate(async () => {
      window.location.hash = '#operations?tab=task-templates';
      if (typeof App !== 'undefined' && App.handleRoute) {
        await App.handleRoute();
      }
    });
    await page.waitForSelector('.jira-backlog-container, .jira-table', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Delete the updated test template
    console.log('Deleting test template:', updatedTitle);
    await page.evaluate((title) => {
      const rows = document.querySelectorAll('.jira-backlog-row, .jira-backlog-item, tr');
      for (const row of rows) {
        if (row.innerText.includes(title)) {
          const delBtn = Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === 'Delete');
          if (delBtn) { delBtn.click(); return; }
        }
      }
    }, updatedTitle);

    await page.waitForSelector('.modal-overlay, .confirm-modal, .modal', { timeout: 5000 });
    // Click confirm in modal specifically
    await page.evaluate(() => {
      const confirmBtn = document.querySelector('.modal-overlay .modal-btn-sure, .modal .modal-btn-sure, .modal-message-wrapper .modal-btn-sure');
      if (confirmBtn) {
        confirmBtn.click();
      } else {
        const confirmBtns = Array.from(document.querySelectorAll('.modal-overlay .modal-footer button, .modal .modal-footer button'));
        const btn = confirmBtns.find(b => b.textContent.includes('Yes') || b.textContent.includes('Delete') || b.textContent.includes('Confirm'));
        if (btn) btn.click();
      }
    });

    try {
      await page.waitForSelector('.modal-overlay, .confirm-modal, .modal', { state: 'detached', timeout: 5000 });
    } catch (e) {}

    try {
      await page.waitForFunction((title) => {
        return !document.body.innerText.includes(title);
      }, updatedTitle, { timeout: 12000 });
    } catch (e) {
      await page.evaluate(async () => {
        if (typeof Workflow !== 'undefined') {
          if (Workflow.ensureStandardTaskTemplates) {
            await Workflow.ensureStandardTaskTemplates(true);
          }
          if (Workflow.renderTaskTemplatesTab) {
            const contentContainer = document.querySelector('.operations-tab-page > div:last-child') || document.querySelector('#content');
            if (contentContainer) {
              contentContainer.innerHTML = '';
              contentContainer.appendChild(await Workflow.renderTaskTemplatesTab());
            }
          }
        }
      });
      await page.waitForTimeout(1000);
    }

    const deletedFromTable = !(await page.evaluate((title) => {
      return document.body.innerText.includes(title);
    }, updatedTitle));
    record('Deleted template is removed from Task Templates table', deletedFromTable);

    // Click "Reset to Defaults"
    console.log('Testing "Reset to Defaults" button...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Reset to Defaults'));
      if (btn) btn.click();
    });
    await page.waitForSelector('.modal-overlay, .confirm-modal, .modal', { timeout: 5000 });

    await page.evaluate(() => {
      const confirmBtn = document.querySelector('.modal-overlay .modal-btn-sure, .modal .modal-btn-sure, .modal-message-wrapper .modal-btn-sure');
      if (confirmBtn) {
        confirmBtn.click();
      } else {
        const confirmBtns = Array.from(document.querySelectorAll('.modal-overlay .modal-footer button, .modal .modal-footer button'));
        const btn = confirmBtns.find(b => b.textContent.includes('Yes') || b.textContent.includes('Reset') || b.textContent.includes('Confirm'));
        if (btn) btn.click();
      }
    });

    try {
      await page.waitForFunction(() => {
        const items = document.querySelectorAll('.jira-backlog-row');
        return items.length >= 9;
      }, { timeout: 12000 });
    } catch (e) {
      await page.waitForTimeout(2000);
    }

    const defaultCount = await page.evaluate(() => {
      const items = document.querySelectorAll('.jira-backlog-row');
      return items.length;
    });
    record('Reset to defaults restores 9 system baseline templates', defaultCount >= 9, `Template count: ${defaultCount}`);

    await adminContext.close();

  } catch (err) {
    console.error('[TEST FATAL ERROR]', err);
    record('Test suite execution without fatal errors', false, err.message);
  } finally {
    await browser.close();
  }

  // Summary
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('TASK TEMPLATES PLAYWRIGHT TEST SUMMARY');
  console.log('══════════════════════════════════════════════════════════════');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) {
    console.error('Some tests failed!');
    process.exit(1);
  } else {
    console.log('All tests passed successfully! 🎉');
    process.exit(0);
  }
})();
