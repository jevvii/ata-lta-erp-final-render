/**
 * Material Design Time Picker
 * Auto-attaches to all <input type="time"> elements in the DOM.
 * Uses MutationObserver to handle dynamically created inputs.
 * 
 * Features:
 *  - Clock-face dial for hour/minute selection
 *  - AM/PM toggle
 *  - Keyboard/manual input toggle
 *  - Smooth animations
 */
const MaterialTimePicker = (() => {
  const processedInputs = new WeakSet();
  const CLOCK_RADIUS = 110;
  const CLOCK_CENTER = 130;
  const NUM_RADIUS = 90;

  /**
   * Format 24h "HH:MM" to display "hh:mm AM/PM"
   */
  function formatDisplay(val) {
    if (!val) return '';
    const parts = val.split(':');
    if (parts.length < 2) return val;
    let h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ' ' + ampm;
  }

  /**
   * Convert 12h values to 24h "HH:MM" string
   */
  function to24h(hour, minute, isAM) {
    let h = hour;
    if (isAM && h === 12) h = 0;
    if (!isAM && h !== 12) h += 12;
    return String(h).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  /**
   * Parse "HH:MM" (24h) string to { hour12, minute, isAM }
   */
  function parse24h(val) {
    if (!val) return { hour12: 12, minute: 0, isAM: true };
    const parts = val.split(':');
    let h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const isAM = h < 12;
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return { hour12: h12, minute: m, isAM };
  }

  function attach(input) {
    if (processedInputs.has(input)) return;
    if (input.getAttribute('type') !== 'time') return;
    processedInputs.add(input);

    const initialValue = input.value || '';
    const originalStyle = input.getAttribute('style') || '';

    // Hide native input
    input.setAttribute('type', 'text');
    input.setAttribute('data-timepicker', 'true');
    input.style.cssText = 'position:absolute;opacity:0.01;pointer-events:none;width:1px;height:1px;overflow:hidden;padding:0;border:none;';
    input.tabIndex = -1;

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'mtp-wrapper';
    const maxWidthMatch = originalStyle.match(/max-width\s*:\s*([^;]+)/);
    if (maxWidthMatch) wrapper.style.maxWidth = maxWidthMatch[1].trim();

    const display = document.createElement('span');
    display.className = 'mtp-display';
    display.textContent = formatDisplay(initialValue) || 'Select time';
    if (!initialValue) display.classList.add('mtp-placeholder');

    const icon = document.createElement('span');
    icon.className = 'mtp-icon';
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

    wrapper.appendChild(display);
    wrapper.appendChild(icon);
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    // Restore value
    input.value = initialValue;

    // Override value property
    const nativeDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, '_mtpDisplay', { value: display, writable: true, configurable: true });

    Object.defineProperty(input, 'value', {
      get() { return nativeDescriptor.get.call(this); },
      set(val) {
        nativeDescriptor.set.call(this, val);
        const d = this._mtpDisplay;
        if (d) {
          d.textContent = formatDisplay(val) || 'Select time';
          d.classList.toggle('mtp-placeholder', !val);
        }
      },
      configurable: true
    });

    input.value = initialValue;

    wrapper.addEventListener('click', (e) => {
      if (input.disabled || input.readOnly) return;
      e.stopPropagation();
      openPicker(input);
    });
  }

  function openPicker(input) {
    const parsed = parse24h(input.value);
    let selectedHour = parsed.hour12;
    let selectedMinute = parsed.minute;
    let isAM = parsed.isAM;
    let selectingHour = true; // true = hour mode, false = minute mode
    let manualMode = false;

    // ---- CREATE DOM ----
    const overlay = document.createElement('div');
    overlay.className = 'mtp-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'mtp-dialog';

    // ---- HEADER ----
    const headerLabel = document.createElement('div');
    headerLabel.className = 'mtp-header-label';
    headerLabel.textContent = 'SELECT TIME';

    const header = document.createElement('div');
    header.className = 'mtp-header';

    const timeDisplay = document.createElement('div');
    timeDisplay.className = 'mtp-time-display';

    const hourBox = document.createElement('button');
    hourBox.type = 'button';
    hourBox.className = 'mtp-time-box mtp-time-active';

    const colonEl = document.createElement('span');
    colonEl.className = 'mtp-time-colon';
    colonEl.textContent = ':';

    const minuteBox = document.createElement('button');
    minuteBox.type = 'button';
    minuteBox.className = 'mtp-time-box';

    const ampmContainer = document.createElement('div');
    ampmContainer.className = 'mtp-ampm';

    const amBtn = document.createElement('button');
    amBtn.type = 'button';
    amBtn.className = 'mtp-ampm-btn' + (isAM ? ' mtp-ampm-active' : '');
    amBtn.textContent = 'AM';

    const pmBtn = document.createElement('button');
    pmBtn.type = 'button';
    pmBtn.className = 'mtp-ampm-btn' + (!isAM ? ' mtp-ampm-active' : '');
    pmBtn.textContent = 'PM';

    ampmContainer.appendChild(amBtn);
    ampmContainer.appendChild(pmBtn);

    timeDisplay.appendChild(hourBox);
    timeDisplay.appendChild(colonEl);
    timeDisplay.appendChild(minuteBox);
    timeDisplay.appendChild(ampmContainer);

    header.appendChild(headerLabel);
    header.appendChild(timeDisplay);

    // ---- BODY (Clock + Manual) ----
    const body = document.createElement('div');
    body.className = 'mtp-body';

    // Clock face container
    const clockContainer = document.createElement('div');
    clockContainer.className = 'mtp-clock-container';

    const clockFace = document.createElement('div');
    clockFace.className = 'mtp-clock-face';

    // Center dot
    const centerDot = document.createElement('div');
    centerDot.className = 'mtp-center-dot';
    clockFace.appendChild(centerDot);

    // Clock hand
    const hand = document.createElement('div');
    hand.className = 'mtp-hand';
    clockFace.appendChild(hand);

    // Hand dot (at the end of the hand)
    const handDot = document.createElement('div');
    handDot.className = 'mtp-hand-dot';
    clockFace.appendChild(handDot);

    clockContainer.appendChild(clockFace);

    // Manual input area
    const manualArea = document.createElement('div');
    manualArea.className = 'mtp-manual-area hidden';

    const manualRow = document.createElement('div');
    manualRow.className = 'mtp-manual-row';

    const manualHourInput = document.createElement('input');
    manualHourInput.type = 'text';
    manualHourInput.className = 'mtp-manual-input';
    manualHourInput.maxLength = 2;
    manualHourInput.placeholder = 'HH';

    const manualColonEl = document.createElement('span');
    manualColonEl.className = 'mtp-manual-colon';
    manualColonEl.textContent = ':';

    const manualMinInput = document.createElement('input');
    manualMinInput.type = 'text';
    manualMinInput.className = 'mtp-manual-input';
    manualMinInput.maxLength = 2;
    manualMinInput.placeholder = 'MM';

    manualRow.appendChild(manualHourInput);
    manualRow.appendChild(manualColonEl);
    manualRow.appendChild(manualMinInput);
    manualArea.appendChild(manualRow);

    const manualLabels = document.createElement('div');
    manualLabels.className = 'mtp-manual-labels';
    manualLabels.innerHTML = '<span>Hour</span><span>Minute</span>';
    manualArea.appendChild(manualLabels);

    body.appendChild(clockContainer);
    body.appendChild(manualArea);

    // ---- FOOTER ----
    const footer = document.createElement('div');
    footer.className = 'mtp-footer';

    const keyboardBtn = document.createElement('button');
    keyboardBtn.type = 'button';
    keyboardBtn.className = 'mtp-keyboard-btn';
    keyboardBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg>';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'mtp-btn-group';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'mtp-btn';
    cancelBtn.textContent = 'CANCEL';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'mtp-btn mtp-btn-ok';
    okBtn.textContent = 'OK';

    btnGroup.appendChild(cancelBtn);
    btnGroup.appendChild(okBtn);

    footer.appendChild(keyboardBtn);
    footer.appendChild(btnGroup);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('mtp-visible'));

    // ---- RENDER FUNCTIONS ----
    let lastHandAngle = null;

    function updateTimeDisplay() {
      hourBox.textContent = String(selectedHour).padStart(2, '0');
      minuteBox.textContent = String(selectedMinute).padStart(2, '0');
      manualHourInput.value = String(selectedHour).padStart(2, '0');
      manualMinInput.value = String(selectedMinute).padStart(2, '0');
    }

    function getShortestAngle(prev, target) {
      if (prev === null || typeof prev !== 'number') return target;
      const delta = ((target - prev + 540) % 360) - 180;
      return prev + delta;
    }

    function setMode(hourMode) {
      selectingHour = hourMode;
      hourBox.classList.toggle('mtp-time-active', hourMode);
      minuteBox.classList.toggle('mtp-time-active', !hourMode);
      renderClock();
    }

    function renderClock() {
      // Remove old number elements
      clockFace.querySelectorAll('.mtp-number').forEach(n => n.remove());

      if (selectingHour) {
        // Render hours 1-12
        for (let i = 1; i <= 12; i++) {
          const angle = (i * 30 - 90) * (Math.PI / 180);
          const x = CLOCK_CENTER + NUM_RADIUS * Math.cos(angle);
          const y = CLOCK_CENTER + NUM_RADIUS * Math.sin(angle);

          const numEl = document.createElement('button');
          numEl.type = 'button';
          numEl.className = 'mtp-number';
          if (i === selectedHour) numEl.classList.add('mtp-number-selected');
          numEl.textContent = i;
          numEl.style.left = x + 'px';
          numEl.style.top = y + 'px';

          numEl.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedHour = i;
            updateTimeDisplay();
            // Auto-switch to minute mode after selecting hour
            setTimeout(() => setMode(false), 200);
          });

          clockFace.appendChild(numEl);
        }

        // CSS rotate: 0°=up, clockwise. Math angle: 0°=right, for cos/sin.
        const targetAngle = (selectedHour % 12) * 30; // 12→0, 3→90, 6→180
        const rotAngle = getShortestAngle(lastHandAngle, targetAngle);
        const mathAngle = (targetAngle - 90) * (Math.PI / 180); // for trig positioning
        hand.style.transform = `rotate(${rotAngle}deg)`;
        hand.style.height = NUM_RADIUS + 'px';
        handDot.style.left = (CLOCK_CENTER + NUM_RADIUS * Math.cos(mathAngle)) + 'px';
        handDot.style.top = (CLOCK_CENTER + NUM_RADIUS * Math.sin(mathAngle)) + 'px';
        lastHandAngle = rotAngle;

      } else {
        // Render minutes 0, 5, 10, ... 55
        for (let i = 0; i < 12; i++) {
          const minVal = i * 5;
          const angle = (i * 30 - 90) * (Math.PI / 180);
          const x = CLOCK_CENTER + NUM_RADIUS * Math.cos(angle);
          const y = CLOCK_CENTER + NUM_RADIUS * Math.sin(angle);

          const numEl = document.createElement('button');
          numEl.type = 'button';
          numEl.className = 'mtp-number';
          if (minVal === selectedMinute) numEl.classList.add('mtp-number-selected');
          numEl.textContent = String(minVal).padStart(2, '0');
          numEl.style.left = x + 'px';
          numEl.style.top = y + 'px';

          numEl.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedMinute = minVal;
            updateTimeDisplay();
            renderClock();
          });

          clockFace.appendChild(numEl);
        }

        // CSS rotate: 0°=up, clockwise. Math angle: 0°=right, for cos/sin.
        const nearestFive = (Math.round(selectedMinute / 5) * 5) % 60;
        const targetAngle = nearestFive * 6; // 0→0, 15→90, 30→180
        const rotAngle = getShortestAngle(lastHandAngle, targetAngle);
        const mathAngle = (targetAngle - 90) * (Math.PI / 180); // for trig positioning
        hand.style.transform = `rotate(${rotAngle}deg)`;
        hand.style.height = NUM_RADIUS + 'px';
        handDot.style.left = (CLOCK_CENTER + NUM_RADIUS * Math.cos(mathAngle)) + 'px';
        handDot.style.top = (CLOCK_CENTER + NUM_RADIUS * Math.sin(mathAngle)) + 'px';
        lastHandAngle = rotAngle;
      }
    }

    // ---- CLOCK DRAG SUPPORT ----
    let isDragging = false;

    function getAngleFromEvent(e) {
      const rect = clockFace.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      let angle = Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI) + 90;
      if (angle < 0) angle += 360;
      return angle;
    }

    function selectFromAngle(angle) {
      if (selectingHour) {
        let hour = Math.round(angle / 30);
        if (hour === 0) hour = 12;
        if (hour > 12) hour = 12;
        selectedHour = hour;
      } else {
        let minute = Math.round(angle / 6);
        if (minute === 60) minute = 0;
        // Snap to nearest 5
        minute = Math.round(minute / 5) * 5;
        if (minute === 60) minute = 0;
        selectedMinute = minute;
      }
      updateTimeDisplay();
      renderClock();
    }

    clockFace.addEventListener('mousedown', (e) => {
      isDragging = true;
      selectFromAngle(getAngleFromEvent(e));
    });
    clockFace.addEventListener('touchstart', (e) => {
      isDragging = true;
      selectFromAngle(getAngleFromEvent(e));
    }, { passive: true });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) selectFromAngle(getAngleFromEvent(e));
    });
    document.addEventListener('touchmove', (e) => {
      if (isDragging) selectFromAngle(getAngleFromEvent(e));
    }, { passive: true });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        // Auto-switch to minute after dragging hour
        if (selectingHour) {
          setTimeout(() => setMode(false), 250);
        }
      }
    });
    document.addEventListener('touchend', () => {
      if (isDragging) {
        isDragging = false;
        if (selectingHour) {
          setTimeout(() => setMode(false), 250);
        }
      }
    });

    // ---- EVENT HANDLERS ----
    hourBox.addEventListener('click', () => setMode(true));
    minuteBox.addEventListener('click', () => setMode(false));

    amBtn.addEventListener('click', () => {
      isAM = true;
      amBtn.classList.add('mtp-ampm-active');
      pmBtn.classList.remove('mtp-ampm-active');
    });

    pmBtn.addEventListener('click', () => {
      isAM = false;
      pmBtn.classList.add('mtp-ampm-active');
      amBtn.classList.remove('mtp-ampm-active');
    });

    // Keyboard/manual toggle
    keyboardBtn.addEventListener('click', () => {
      manualMode = !manualMode;
      if (manualMode) {
        clockContainer.classList.add('hidden');
        manualArea.classList.remove('hidden');
        manualHourInput.focus();
        manualHourInput.select();
        // Switch icon to clock
        keyboardBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>';
      } else {
        // Parse manual inputs
        const h = parseInt(manualHourInput.value, 10);
        const m = parseInt(manualMinInput.value, 10);
        if (h >= 1 && h <= 12) selectedHour = h;
        if (m >= 0 && m <= 59) selectedMinute = m;
        updateTimeDisplay();

        clockContainer.classList.remove('hidden');
        manualArea.classList.add('hidden');
        renderClock();
        // Switch icon to keyboard
        keyboardBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg>';
      }
    });

    // Manual input: only allow digits, auto-advance
    [manualHourInput, manualMinInput].forEach(inp => {
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/[^0-9]/g, '').slice(0, 2);
      });
    });

    manualHourInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || (manualHourInput.value.length >= 2 && e.key >= '0' && e.key <= '9')) {
        // Don't prevent if it's a digit and we're at 2 chars — let input handler handle
        if (e.key === 'Enter') e.preventDefault();
        manualMinInput.focus();
        manualMinInput.select();
      }
    });

    manualMinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        okBtn.click();
      }
    });

    function close() {
      overlay.classList.remove('mtp-visible');
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
      // If in manual mode, parse first
      if (manualMode) {
        const h = parseInt(manualHourInput.value, 10);
        const m = parseInt(manualMinInput.value, 10);
        if (h >= 1 && h <= 12) selectedHour = h;
        if (m >= 0 && m <= 59) selectedMinute = m;
      }
      const val = to24h(selectedHour, selectedMinute, isAM);
      input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      close();
    });

    function handleKeydown(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', handleKeydown);

    // Initial render
    updateTimeDisplay();
    renderClock();
  }

  function init() {
    document.querySelectorAll('input[type="time"]').forEach(attach);
  }

  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'INPUT' && node.getAttribute('type') === 'time') {
            requestAnimationFrame(() => attach(node));
          }
          if (node.querySelectorAll) {
            const timeInputs = node.querySelectorAll('input[type="time"]');
            if (timeInputs.length) {
              requestAnimationFrame(() => {
                timeInputs.forEach(inp => attach(inp));
              });
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); startObserver(); });
  } else {
    init();
    startObserver();
  }

  return { init, attach };
})();
