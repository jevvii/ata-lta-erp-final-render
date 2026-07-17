/**
 * Material Design Date Picker
 * Auto-attaches to all <input type="date"> elements in the DOM.
 * Uses MutationObserver to handle dynamically created inputs.
 */
const MaterialDatePicker = (() => {
  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const processedInputs = new WeakSet();

  function formatDisplay(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return dateStr;
    return MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function formatHeader(date) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()] + ', ' + MONTHS_SHORT[date.getMonth()] + ' ' + date.getDate();
  }

  function toDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function parseDate(str) {
    if (!str) return null;
    const d = new Date(str + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  function attach(input) {
    if (!input || processedInputs.has(input) || input.dataset.mdpAttached === 'true') return;
    if (input.getAttribute('type') !== 'date') return;
    processedInputs.add(input);
    input.dataset.mdpAttached = 'true';

    // Capture the initial value before changing type
    const initialValue = input.value || '';
    // Capture original inline style before we overwrite it
    const originalStyle = input.getAttribute('style') || '';

    // Prevent native picker by switching to text
    input.setAttribute('type', 'text');
    input.setAttribute('data-datepicker', 'true');
    input.style.cssText = 'position:absolute;opacity:0.01;pointer-events:none;width:1px;height:1px;overflow:hidden;padding:0;border:none;';
    input.tabIndex = -1;

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'mdp-wrapper';
    // Copy max-width style if set on the original input
    const maxWidthMatch = originalStyle.match(/max-width\s*:\s*([^;]+)/);
    if (maxWidthMatch) {
      wrapper.style.maxWidth = maxWidthMatch[1].trim();
    }

    const display = document.createElement('span');
    display.className = 'mdp-display';
    display.textContent = formatDisplay(initialValue) || 'Select date';
    if (!initialValue) display.classList.add('mdp-placeholder');

    const icon = document.createElement('span');
    icon.className = 'mdp-icon';
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

    wrapper.appendChild(icon);
    wrapper.appendChild(display);

    // Insert wrapper before the input, then move input inside wrapper
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    // Restore value after type change
    input.value = initialValue;

    // Override the value property to keep display in sync
    const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, '_mdpDisplay', { value: display, writable: true, configurable: true });

    Object.defineProperty(input, 'value', {
      get() {
        return nativeDescriptor.get.call(this);
      },
      set(val) {
        nativeDescriptor.set.call(this, val);
        const d = this._mdpDisplay;
        if (d) {
          d.textContent = formatDisplay(val) || 'Select date';
          d.classList.toggle('mdp-placeholder', !val);
        }
        // Sync the filter-field clear button and has-value state since the
        // material datepicker replaces the input value setter and bypasses
        // wrapFilterFieldWithClear's own visibility update.
        const filterWrapper = this.closest('.filter-field-wrapper');
        if (filterWrapper) {
          const hasVal = !!val;
          filterWrapper.classList.toggle('has-value', hasVal);
          const clearBtn = filterWrapper.querySelector('.filter-field-clear');
          if (clearBtn) clearBtn.style.display = hasVal ? 'flex' : 'none';
        }
      },
      configurable: true
    });

    // Set initial display (trigger our setter)
    input.value = initialValue;

    wrapper.addEventListener('click', (e) => {
      if (input.disabled || input.readOnly) return;
      e.stopPropagation();
      openPicker(input, display);
    });
  }

  function openPicker(input, displayEl) {
    // Parse current value or use today
    const currentVal = parseDate(input.value);
    let viewDate = currentVal ? new Date(currentVal) : new Date();
    let selectedDate = currentVal ? new Date(currentVal) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let yearSelectMode = false;
    let manualInputMode = false;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'mdp-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'mdp-dialog';

    // ---- HEADER ----
    const header = document.createElement('div');
    header.className = 'mdp-header';

    const headerLabel = document.createElement('div');
    headerLabel.className = 'mdp-header-label';
    headerLabel.textContent = 'SELECT DATE';
    header.appendChild(headerLabel);

    const headerRow = document.createElement('div');
    headerRow.className = 'mdp-header-row';

    const headerDate = document.createElement('div');
    headerDate.className = 'mdp-header-date';
    headerDate.textContent = selectedDate ? formatHeader(selectedDate) : formatHeader(today);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'mdp-edit-btn';
    editBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

    headerRow.appendChild(headerDate);
    headerRow.appendChild(editBtn);
    header.appendChild(headerRow);

    // Manual input area (hidden by default)
    const manualArea = document.createElement('div');
    manualArea.className = 'mdp-manual-area hidden';
    const manualInput = document.createElement('input');
    manualInput.type = 'text';
    manualInput.className = 'mdp-manual-input';
    manualInput.placeholder = 'MM/DD/YYYY';
    manualInput.maxLength = 10;
    if (selectedDate) {
      manualInput.value = String(selectedDate.getMonth() + 1).padStart(2, '0') + '/' +
        String(selectedDate.getDate()).padStart(2, '0') + '/' + selectedDate.getFullYear();
    }
    manualArea.appendChild(manualInput);

    // ---- BODY ----
    const body = document.createElement('div');
    body.className = 'mdp-body';

    // Nav row
    const nav = document.createElement('div');
    nav.className = 'mdp-nav';

    const monthBtn = document.createElement('button');
    monthBtn.type = 'button';
    monthBtn.className = 'mdp-month-btn';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'mdp-nav-arrow';
    prevBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'mdp-nav-arrow';
    nextBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>';

    nav.appendChild(monthBtn);
    const navArrows = document.createElement('div');
    navArrows.className = 'mdp-nav-arrows';
    navArrows.appendChild(prevBtn);
    navArrows.appendChild(nextBtn);
    nav.appendChild(navArrows);

    // Calendar grid
    const grid = document.createElement('div');
    grid.className = 'mdp-grid';

    // Year select panel
    const yearPanel = document.createElement('div');
    yearPanel.className = 'mdp-year-panel hidden';

    body.appendChild(nav);
    body.appendChild(manualArea);
    body.appendChild(grid);
    body.appendChild(yearPanel);

    // ---- FOOTER ----
    const footer = document.createElement('div');
    footer.className = 'mdp-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'mdp-btn';
    cancelBtn.textContent = 'CANCEL';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'mdp-btn mdp-btn-ok';
    okBtn.textContent = 'OK';

    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Force reflow then animate
    requestAnimationFrame(() => {
      overlay.classList.add('mdp-visible');
    });

    // ---- RENDER FUNCTIONS ----
    function renderCalendar() {
      grid.innerHTML = '';
      yearPanel.classList.add('hidden');
      grid.classList.remove('hidden');
      nav.style.display = '';
      manualArea.classList.add('hidden');
      yearSelectMode = false;
      manualInputMode = false;
      editBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

      monthBtn.innerHTML = MONTHS[viewDate.getMonth()] + ' ' + viewDate.getFullYear() +
        ' <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="margin-left:4px;vertical-align:middle;"><path d="M7 10l5 5 5-5z"/></svg>';

      // Day headers
      DAYS.forEach(d => {
        const cell = document.createElement('div');
        cell.className = 'mdp-day-header';
        cell.textContent = d;
        grid.appendChild(cell);
      });

      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      // Empty cells for days before the 1st
      for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'mdp-day-empty';
        grid.appendChild(empty);
      }

      // Day cells
      for (let d = 1; d <= daysInMonth; d++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'mdp-day';
        cell.textContent = d;

        const cellDate = new Date(year, month, d);
        const isToday = cellDate.getFullYear() === today.getFullYear() &&
          cellDate.getMonth() === today.getMonth() &&
          cellDate.getDate() === today.getDate();
        const isSelected = selectedDate &&
          cellDate.getFullYear() === selectedDate.getFullYear() &&
          cellDate.getMonth() === selectedDate.getMonth() &&
          cellDate.getDate() === selectedDate.getDate();

        if (isSelected) cell.classList.add('mdp-selected');
        else if (isToday) cell.classList.add('mdp-today');

        cell.addEventListener('click', () => {
          selectedDate = new Date(year, month, d);
          headerDate.textContent = formatHeader(selectedDate);
          manualInput.value = String(selectedDate.getMonth() + 1).padStart(2, '0') + '/' +
            String(selectedDate.getDate()).padStart(2, '0') + '/' + selectedDate.getFullYear();
          renderCalendar();
        });

        grid.appendChild(cell);
      }
    }

    function renderYearPanel() {
      yearPanel.innerHTML = '';
      yearPanel.classList.remove('hidden');
      grid.classList.add('hidden');
      manualArea.classList.add('hidden');
      nav.style.display = 'none';
      yearSelectMode = true;
      manualInputMode = false;

      const currentYear = viewDate.getFullYear();
      const startYear = currentYear - 80;
      const endYear = currentYear + 30;

      for (let y = startYear; y <= endYear; y++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mdp-year-btn';
        btn.textContent = y;
        if (y === currentYear) btn.classList.add('mdp-year-active');

        btn.addEventListener('click', () => {
          viewDate.setFullYear(y);
          renderCalendar();
        });

        yearPanel.appendChild(btn);
      }

      // Scroll to active year
      requestAnimationFrame(() => {
        const active = yearPanel.querySelector('.mdp-year-active');
        if (active) active.scrollIntoView({ block: 'center' });
      });
    }

    // ---- EVENT HANDLERS ----
    prevBtn.addEventListener('click', () => {
      viewDate.setMonth(viewDate.getMonth() - 1);
      renderCalendar();
    });

    nextBtn.addEventListener('click', () => {
      viewDate.setMonth(viewDate.getMonth() + 1);
      renderCalendar();
    });

    monthBtn.addEventListener('click', () => {
      if (yearSelectMode) {
        renderCalendar();
      } else {
        renderYearPanel();
      }
    });

    editBtn.addEventListener('click', () => {
      if (!manualInputMode) {
        // Switch to manual input mode
        manualInputMode = true;
        manualArea.classList.remove('hidden');
        grid.classList.add('hidden');
        nav.style.display = 'none';
        yearPanel.classList.add('hidden');
        manualInput.focus();
        manualInput.select();
        editBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/></svg>';
      } else {
        // Switch back to calendar — try parsing manual input
        const parts = manualInput.value.split('/');
        if (parts.length === 3) {
          const m = parseInt(parts[0], 10);
          const d = parseInt(parts[1], 10);
          const y = parseInt(parts[2], 10);
          if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2099) {
            const parsed = new Date(y, m - 1, d);
            if (!isNaN(parsed)) {
              selectedDate = parsed;
              viewDate = new Date(parsed);
              headerDate.textContent = formatHeader(selectedDate);
            }
          }
        }
        renderCalendar();
      }
    });

    // Auto-format manual input with slashes
    manualInput.addEventListener('input', () => {
      let val = manualInput.value.replace(/[^0-9]/g, '');
      if (val.length > 2) val = val.slice(0, 2) + '/' + val.slice(2);
      if (val.length > 5) val = val.slice(0, 5) + '/' + val.slice(5);
      if (val.length > 10) val = val.slice(0, 10);
      manualInput.value = val;
    });

    // Enter key in manual input
    manualInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        editBtn.click(); // toggle back to calendar (validates input)
      }
    });

    function close() {
      overlay.classList.remove('mdp-visible');
      document.removeEventListener('keydown', handleKeydown);
      setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
      }, 250);
    }

    cancelBtn.addEventListener('click', close);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    okBtn.addEventListener('click', () => {
      if (selectedDate) {
        const val = toDateStr(selectedDate);
        input.value = val;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close();
    });

    // Keyboard
    function handleKeydown(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', handleKeydown);

    renderCalendar();
  }

  function init() {
    document.querySelectorAll('input[type="date"]').forEach(attach);
  }

  // MutationObserver to auto-attach to dynamically created date inputs
  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'INPUT' && node.getAttribute('type') === 'date') {
            requestAnimationFrame(() => attach(node));
          }
          // Check descendants
          if (node.querySelectorAll) {
            const dateInputs = node.querySelectorAll('input[type="date"]');
            if (dateInputs.length) {
              requestAnimationFrame(() => {
                dateInputs.forEach(inp => attach(inp));
              });
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); startObserver(); });
  } else {
    init();
    startObserver();
  }

  return { init, attach };
})();
