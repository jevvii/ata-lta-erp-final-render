/**
 * Utility Functions
 * Safe DOM builder, formatting helpers, and general utilities.
 */

// Centralized Loading Manager to handle state and timing concerns.
// Scoped to window.LoadingManager to avoid global namespace pollution. Timings are derived from CSS variables.
window.LoadingManager = {
  timeoutId: null,

  getTiming: function(cssVar, defaultVal) {
    let raw = '';
    try {
      raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    } catch (e) {}
    const val = raw || defaultVal;
    const parsed = parseFloat(val);
    if (isNaN(parsed)) {
      const fallback = parseFloat(defaultVal);
      return (isNaN(fallback) ? 0.25 : fallback) * (defaultVal.endsWith('ms') ? 1 : 1000);
    }
    return parsed * (val.endsWith('ms') ? 1 : 1000);
  },

  get DELAY_MS() {
    return this.getTiming('--delay-loading', '0.25s');
  },

  get TRANSITION_MS() {
    return this.getTiming('--transition-loading', '0.25s');
  },

  start: function() {
    this.clear();
    this.timeoutId = setTimeout(() => {
      document.documentElement.classList.add('loading-active');
      const ls = document.getElementById('loading-screen');
      if (ls) ls.classList.remove('hidden');
    }, this.DELAY_MS);
  },

  clear: function() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
};

if (sessionStorage.getItem('is_syncing') === 'true') {
  window.LoadingManager.start();
}

/**
 * Lightweight, privacy-safe telemetry for the ERP SPA.
 *
 * - In development (localhost / 127.0.0.1 / *.local), route-switch durations are
 *   logged to the console from the matching performance.measure entries.
 * - In UAT / production, a capped summary is stored in sessionStorage under
 *   __erp_perf__ (last 50 entries). No user-identifiable data is recorded and
 *   nothing is sent to an external service.
 */
window.ErpTelemetry = {
  STORAGE_KEY: '__erp_perf__',
  MAX_ENTRIES: 50,

  isDev() {
    try {
      const host = location.hostname;
      return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
    } catch (e) {
      return false;
    }
  },

  /**
   * Record a route switch measurement.
   * @param {string} routeName - Base hash route (e.g. #dashboard).
   * @param {number} duration - Duration in milliseconds.
   * @param {boolean} cached - Whether the route rendered from module cache.
   */
  recordRouteSwitch(routeName, duration, cached) {
    const entry = {
      route: routeName,
      duration: typeof duration === 'number' ? Math.round(duration * 100) / 100 : 0,
      cached: !!cached,
      ts: Date.now()
    };

    if (this.isDev()) {
      console.log(
        `[ERP Telemetry] route switch ${entry.route}: ${entry.duration.toFixed(2)}ms (${entry.cached ? 'cached' : 'fresh'})`
      );
      return;
    }

    try {
      const raw = sessionStorage.getItem(this.STORAGE_KEY);
      const entries = raw ? JSON.parse(raw) : [];
      entries.push(entry);
      while (entries.length > this.MAX_ENTRIES) entries.shift();
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      // Ignore storage errors (private mode, quota exceeded, etc.).
    }
  },

  /**
   * Read the current telemetry summary from sessionStorage.
   * Useful for ad-hoc debugging or future dashboard instrumentation.
   */
  getPerfSummary() {
    try {
      const raw = sessionStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
};

function formatPHP(n) {
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function getInitials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
}

function groupColor(str) {
  const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316'];
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function generateId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/**
 * Generate a sequential, zero-padded ID for a given table/prefix.
 * Falls back to a random ID if the table is not available.
 */
function generateSequentialId(prefix, table) {
  if (typeof DB === 'undefined' || !DB.getAll) {
    return generateId(prefix);
  }
  const all = DB.getAll(table);
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  let max = 0;
  all.forEach(r => {
    const m = String(r.id || '').match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return prefix + '-' + String(max + 1).padStart(4, '0');
}

/**
 * Generate the next sequential invoice number for an entity.
 * Uses the invoices API instead of the local DB so generated numbers stay
 * in sync with the server-side sequence.
 */
async function nextInvoiceNumber(entity) {
  const year = new Date().getFullYear();
  const prefix = entity + '-SI-' + year + '-';
  try {
    const api = (typeof window !== 'undefined' && window.apiClient) || null;
    const res = api ? await api.invoices.list({ limit: 100, sortBy: 'createdAt', sortOrder: 'desc' }) : null;
    const list = res?.data || [];
    const maxNum = list.reduce((max, inv) => {
      const numStr = inv.invoice_number || inv.invoiceNumber || '';
      if (!numStr.startsWith(prefix)) return max;
      const parts = numStr.split('-');
      const num = parseInt(parts[parts.length - 1], 10);
      return !isNaN(num) && num > max ? num : max;
    }, 0);
    return prefix + String(maxNum + 1).padStart(3, '0');
  } catch (e) {
    console.error('[nextInvoiceNumber] failed to load invoices', e);
    return prefix + '001';
  }
}

/**
 * Generate a random tracking number for an entity.
 * Mirrors the legacy Transmittal.generateTrackingNumber behavior so it can be
 * used from the operations workflow without requiring the transmittal bundle.
 */
function generateTrackingNumber(entity) {
  const year = new Date().getFullYear();
  const prefix = entity + '-TX-' + year + '-';
  const suffix = String(Math.floor(Math.random() * 900) + 100).padStart(3, '0');
  return prefix + suffix;
}

function showFieldError(field, message) {
  if (typeof field === 'string') field = document.getElementById(field);
  if (!field || !field.parentElement) return;
  // If the field is inside a datepicker/timepicker wrapper, target the form-group parent instead
  let container = field.parentElement;
  if (!container) return;
  if (container && (container.classList.contains('mdp-wrapper') || container.classList.contains('mtp-wrapper'))) {
    // Also show error style on the wrapper
    container.classList.add('input-error');
    container = container.parentElement;
  }
  if (!container) return;
  let errorEl = container.querySelector('.field-error');
  if (!errorEl) {
    errorEl = document.createElement('span');
    errorEl.className = 'field-error';
    container.appendChild(errorEl);
  }
  errorEl.textContent = message;
  field.classList.add('input-error');
}

function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach(el => el.remove());
  form.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
}

function validateRequiredFields(form) {
  const required = form.querySelectorAll('[required]');
  let valid = true;
  clearFieldErrors(form);
  required.forEach(field => {
    if (!field.value.trim()) {
      valid = false;
      showFieldError(field, 'This field is required');
    }
  });
  return valid;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // only for static HTML in plan
    else if (k === 'disabled') node.disabled = !!v;
    else node.setAttribute(k, v);
  }
  children.forEach(c => {
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  });
  return node;
}

function parseHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.firstChild || document.createTextNode('');
}

/**
 * Build a Notion-style empty-state v2 component.
 * @param {Object} opts
 * @param {string} [opts.variant='zero-state'] - 'zero-state' | 'filtered-empty' | 'compact' | 'card-empty'
 * @param {string} [opts.icon] - SVG string
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {Array<{text:string, className:string, onClick:Function}>} [opts.actions]
 * @returns {HTMLElement}
 */
function renderEmptyStateV2(opts = {}) {
  const { variant = 'zero-state', icon, title, body, actions = [], className, style } = opts;
  const classes = ['empty-state-v2', variant, className].filter(Boolean).join(' ');
  const wrap = el('div', { class: classes });
  if (style) wrap.setAttribute('style', style);
  if (icon) {
    wrap.appendChild(el('div', { class: 'empty-state-icon', html: icon }));
  }
  wrap.appendChild(el('div', { class: 'empty-state-title', text: title }));
  if (body) {
    wrap.appendChild(el('div', { class: 'empty-state-body', text: body }));
  }
  if (actions.length > 0) {
    const actionsWrap = el('div', { class: 'empty-state-actions' });
    actions.forEach(action => {
      let btn;
      if (action.tag === 'a' || action.href != null) {
        btn = el('a', { href: action.href || 'javascript:void(0)', class: action.className || 'empty-state-clear', text: action.text });
      } else {
        btn = el('button', { type: 'button', class: action.className || 'btn btn-primary btn-sm', text: action.text });
      }
      if (action.onClick) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          action.onClick(e);
        });
      }
      actionsWrap.appendChild(btn);
    });
    wrap.appendChild(actionsWrap);
  }
  return wrap;
}

/**
 * Shared, simple wrapper for a consistent empty-state across pages, views, and cards.
 * @param {string} title - Primary empty-state message.
 * @param {string} [body] - Optional secondary message.
 * @param {Object} [opts] - Overrides for renderEmptyStateV2 (variant, icon, actions, etc.).
 * @returns {HTMLElement}
 */
function renderEmptyState(title, body, opts = {}) {
  return renderEmptyStateV2({
    title,
    body,
    variant: opts.variant || (body ? 'zero-state' : 'compact'),
    ...opts
  });
}

/**
 * Render a consistent "no filter results" empty-state with a search icon
 * and optional clear-filters action.
 * @param {string} title - e.g. "No invoices match your filters"
 * @param {string} [body]
 * @param {Array} [actions] - renderEmptyStateV2 actions array; default none.
 * @returns {HTMLElement}
 */
function renderFilterEmptyState(title, body, actions = []) {
  return renderEmptyStateV2({
    variant: 'filtered-empty',
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>',
    title,
    body: body || 'Try adjusting or clearing the active filters to see more results.',
    actions
  });
}

/**
 * Render a shareable module page tab navigation bar.
 * @param {Array} tabs - [{ key, label, icon?: string, count?: number }]
 * @param {string} currentKey - active tab key
 * @param {Function} onTabChange - (key) => void
 * @returns {HTMLElement}
 */
function renderModuleTabNav(tabs, currentKey, onTabChange) {
  const tabNav = el('div', { class: 'module-tab-nav' });
  tabs.forEach(tab => {
    const btn = el('button', { class: 'module-tab-link' + (currentKey === tab.key ? ' active' : '') });
    if (tab.icon) btn.appendChild(parseHTML(tab.icon));
    btn.appendChild(document.createTextNode(' ' + tab.label));
    if (tab.count !== undefined) {
      btn.appendChild(document.createTextNode(' '));
      btn.appendChild(el('span', { class: 'module-badge-count', text: String(tab.count) }));
    }
    btn.addEventListener('click', () => onTabChange(tab.key));
    tabNav.appendChild(btn);
  });
  return tabNav;
}

/**
 * Compact board-card icons used across Operations, Billing, Disbursement,
 * and Transmittal boards to match the Jira-style reference card.
 */
const BoardCardIcons = {
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1.8 1.8"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1.8-1.8"/></svg>',
  calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  signal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="14"/><line x1="10" y1="20" x2="10" y2="10"/><line x1="14" y1="20" x2="14" y2="6"/><line x1="18" y1="20" x2="18" y2="2"/></svg>',
  comment: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 014 11.5a8.5 8.5 0 018.5-8.5 8.38 8.38 0 013.8.9L21 11.5z"/></svg>',
  attachment: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>',
  checklist: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
  more: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
  task: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>',
  document: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  billing: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 15h.01M12 15h.01M16 15h.01"/></svg>',
  disbursement: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><circle cx="12" cy="15" r="2"/></svg>',
  transmittal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="3 8 12 14 21 8"/></svg>',
  checkCircle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  reject: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  clock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
};

/**
 * Build a compact, Jira-style board card.
 *
 * @param {Object} opts
 * @param {string} opts.key - Item key shown next to the link icon (e.g. WR-0001).
 * @param {string} [opts.statusColor] - Color for the status dot and left border.
 * @param {string} opts.title - Primary card title.
 * @param {string} [opts.description] - Secondary detail text.
 * @param {string} [opts.date] - Date shown with a calendar icon.
 * @param {string} [opts.priority] - Priority/status label shown with signal bars.
 * @param {string} [opts.priorityClass] - Extra CSS class for priority color (e.g. card-v2-priority-high).
 * @param {Array<{icon:string, value:any}>} [opts.counts] - Footer counts (e.g. comments, attachments).
 * @param {Array<{name?:string, avatarUrl?:string}>} [opts.avatars] - Footer avatars.
 * @param {Function} [opts.onClick] - Card click handler.
 * @param {Function} [opts.moreOptions] - Optional "..." button click handler.
 * @returns {HTMLElement}
 */
function buildProgressRingSVG(progress, color) {
  const pct = Math.max(0, Math.min(100, Number(progress) || 0));
  const r = 6;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return `<svg width="14" height="14" viewBox="0 0 14 14" class="card-v2-progress-ring">
    <circle cx="7" cy="7" r="${r}" fill="none" stroke="var(--color-border, #e2e8f0)" stroke-width="2"/>
    <circle cx="7" cy="7" r="${r}" fill="none" stroke="${color || 'var(--color-text-muted)'}" stroke-width="2"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
      transform="rotate(-90 7 7)"/>
  </svg>`;
}

function buildCompactBoardCard(opts) {
  const card = el('div', { class: 'board-card-v2 compact' });

  // 1. Header Row
  const header = el('div', { class: 'card-v2-header' });
  const keyGroup = el('div', { class: 'card-v2-key-group' });
  keyGroup.appendChild(el('span', { class: 'card-v2-key-icon', html: BoardCardIcons.link }));
  keyGroup.appendChild(el('span', { class: 'card-v2-key', text: opts.key || '' }));
  if (opts.progress !== undefined && opts.progress !== null) {
    keyGroup.appendChild(el('span', {
      class: 'card-v2-status-dot',
      html: buildProgressRingSVG(opts.progress, opts.statusColor)
    }));
  } else if (opts.statusColor) {
    keyGroup.appendChild(el('span', {
      class: 'card-v2-status-dot',
      style: 'border-color:' + opts.statusColor + ';'
    }));
  }
  header.appendChild(keyGroup);

  const moreBtn = el('button', {
    class: 'card-v2-menu',
    html: BoardCardIcons.more,
    type: 'button',
    'aria-label': 'More options'
  });
  moreBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (typeof opts.moreOptions === 'function') opts.moreOptions(e);
    // Edge-aware adjustment runs after the menu is rendered open.
    const menu = moreWrap.querySelector('.action-menu-list');
    if (menu) {
      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        menu.classList.remove('edge-left', 'edge-right');
        if (rect.right > viewportWidth - 8) {
          menu.classList.add('edge-left');
        } else if (rect.left < 8) {
          menu.classList.add('edge-right');
        }
      });
    }
  });
  const moreWrap = el('div', { class: 'action-menu card-v2-action-menu' });
  moreWrap.appendChild(moreBtn);
  // Default right-aligned menu; .edge-left / .edge-right classes override position
  moreWrap.style.marginLeft = 'auto';
  header.appendChild(moreWrap);
  card.appendChild(header);

  // 2. Title
  const body = el('div', { class: 'card-v2-body' });
  if (opts.title) body.appendChild(el('div', { class: 'card-v2-title', text: opts.title }));

  // 3. Description
  if (opts.description) body.appendChild(el('div', { class: 'card-v2-desc', text: opts.description }));

  // 3b. Additional muted detail paragraph (e.g. work-request description).
  if (opts.detail) {
    body.appendChild(el('div', { class: 'card-v2-detail', text: opts.detail }));
  }
  card.appendChild(body);

  // 4. Metadata Row (date left, priority right)
  const metaRow = el('div', { class: 'card-v2-meta-row' });
  const metaLeft = el('div', { class: 'card-v2-meta-left' });
  if (opts.date) {
    metaLeft.appendChild(el('span', { class: 'card-v2-meta-icon', html: BoardCardIcons.calendar }));
    metaLeft.appendChild(el('span', { class: 'card-v2-meta-text', text: escapeHtml(opts.date) }));
  }
  metaRow.appendChild(metaLeft);

  const metaRight = el('div', { class: 'card-v2-meta-right' });
  if (opts.priority) {
    const priorityEl = el('div', { class: 'card-v2-priority ' + (opts.priorityClass || '') });
    priorityEl.innerHTML = BoardCardIcons.signal + '<span>' + escapeHtml(opts.priority) + '</span>';
    metaRight.appendChild(priorityEl);
  }
  metaRow.appendChild(metaRight);
  card.appendChild(metaRow);

  // 5. Footer Row (avatars left, counts right)
  const footer = el('div', { class: 'card-v2-footer' });
  const footerLeft = el('div', { class: 'card-v2-footer-left' });
  if (opts.avatars && opts.avatars.length) {
    const avWrap = el('div', { class: 'card-v2-avatars' });
    opts.avatars.slice(0, 3).forEach(u => {
      const av = el('div', { class: 'avatar-xs', title: u.name || '' });
      if (u.avatarUrl) {
        av.style.backgroundImage = "url('" + u.avatarUrl + "')";
      } else {
        av.textContent = (u.name || '?').slice(0, 1).toUpperCase();
        av.style.background = 'var(--color-bg-muted)';
        av.style.color = 'var(--color-text)';
        av.style.display = 'flex';
        av.style.alignItems = 'center';
        av.style.justifyContent = 'center';
        av.style.fontSize = '10px';
        av.style.fontWeight = '700';
      }
      avWrap.appendChild(av);
    });
    footerLeft.appendChild(avWrap);
  }
  footer.appendChild(footerLeft);

  const footerRight = el('div', { class: 'card-v2-footer-right' });
  if (opts.badges && opts.badges.length) {
    opts.badges.forEach(b => footerRight.appendChild(b));
  }
  if (opts.counts && opts.counts.length) {
    opts.counts.forEach(c => {
      if (!c.value) return;
      footerRight.appendChild(el('div', { class: 'card-v2-count', html: c.icon + ' ' + String(c.value) }));
    });
  }
  footer.appendChild(footerRight);
  card.appendChild(footer);

  if (typeof opts.onClick === 'function') {
    card.addEventListener('click', opts.onClick);
  }

  return card;
}


/**
 * View Mode Icons (Lucide-style, widely compatible SVGs)
 * Used across Table / Board / List toggles in all modules.
 */
const ViewIcons = {
  table: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
  board: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="18" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>',
  list: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
  group: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="7" rx="1"/><line x1="11" y1="7" x2="21" y2="7"/><rect x="3" y="14" width="5" height="7" rx="1"/><line x1="11" y1="17" x2="21" y2="17"/></svg>'
};

const PaymentIcons = {
  'GCash':    { color: '#005CEE', bg: '#EBF3FF', label: 'GCash', svg: '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#005CEE"/><path d="M12 6c-3.3 0-6 2.7-6 6s2.7 6 6 6c3 0 5.6-2.3 5.9-5.2h-5.9v-2h8c.1.6.1 1.2.1 1.9 0 4.2-3.4 7.3-8.1 7.3-4.5 0-8.1-3.6-8.1-8s3.6-8 8.1-8c2.2 0 4.2.8 5.7 2.3l-1.9 1.9c-1-.9-2.3-1.5-3.8-1.5z" fill="white"/></svg>' },
  'Maya':     { color: '#000000', bg: '#E5FDF0', label: 'Maya', svg: '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#000000"/><path d="M6.5 16.5V7.5h2.8l2.7 4 2.7-4h2.8v9h-2.2v-5.4l-2.4 3.1h-1.8l-2.4-3.1v5.4h-2.2z" fill="#00E84D"/></svg>' },
  'PayPal':   { color: '#1E40AF', bg: '#EFF6FF', label: 'PayPal', svg: '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#1E40AF"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="10" font-weight="bold" font-family="Arial">P</text></svg>' },
  'Credit Card':{ color: '#1E293B', bg: '#F8FAFC', label: 'Credit', svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1E293B" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>' },
  'Debit Card': { color: '#1E293B', bg: '#F8FAFC', label: 'Debit', svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1E293B" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>' },
  'Bank Transfer':{ color: '#0369A1', bg: '#E0F2FE', label: 'Bank', svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0369A1" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><path d="M3 21h18M4 18h16M5 18v-6M9 18v-6M15 18v-6M19 18v-6M2 12l10-8 10 8"/></svg>' },
  'Check':    { color: '#B45309', bg: '#FEF3C7', label: 'Check', svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B45309" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 12l3 3 5-5"/></svg>' },
  'Cash':     { color: '#15803D', bg: '#DCFCE7', label: 'Cash', svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8"/><text x="12" y="16" text-anchor="middle" fill="#15803D" font-size="10" font-weight="bold" font-family="Arial">₱</text></svg>' },
  'Other Digital':{ color: '#64748B', bg: '#F1F5F9', label: 'Digital', svg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 17h.01"/></svg>' }
};

/**
 * Searchable Dropdown (Combobox)
 * Drop-in replacement for <select> in filter bars.
 * Returns a wrapper div with .value getter/setter and dispatches 'change' events.
 *
 * @param {Object} opts
 * @param {string} opts.placeholder - Placeholder text (e.g. 'All Employees')
 * @param {Array<{value:string, text:string}>} opts.options - The selectable options
 * @param {string} [opts.maxWidth] - Optional max-width CSS value
 * @returns {HTMLElement} wrapper element with .value property
 */
function createSearchableDropdown({ placeholder, options, maxWidth, allowFreeText = false, addNewLabel = null }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'searchable-dropdown';
  if (maxWidth) wrapper.style.maxWidth = maxWidth;

  let iconHtml = '';
  if (placeholder.includes('Client')) {
    iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  } else if (placeholder.includes('Employee') || placeholder.includes('Uploader')) {
    iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>';
  }

  if (iconHtml) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'searchable-dropdown-icon';
    iconSpan.innerHTML = iconHtml;
    wrapper.appendChild(iconSpan);
    wrapper.classList.add('has-icon');
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'searchable-dropdown-input';
  input.placeholder = placeholder;
  input.setAttribute('autocomplete', 'off');

  const arrow = document.createElement('span');
  arrow.className = 'searchable-dropdown-arrow';
  arrow.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  const clearBtn = document.createElement('span');
  clearBtn.className = 'searchable-dropdown-clear';
  clearBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg>';
  clearBtn.style.display = 'none';

  const listbox = document.createElement('div');
  listbox.className = 'searchable-dropdown-listbox';

  wrapper.appendChild(input);
  wrapper.appendChild(clearBtn);
  wrapper.appendChild(arrow);
  wrapper.appendChild(listbox);

  let selectedValue = '';
  let selectedText = '';
  let isOpen = false;
  let highlightIdx = -1;

  function renderList(filter) {
    listbox.innerHTML = '';
    const query = (filter || '').toLowerCase();
    const filtered = options.filter(o => !query || o.text.toLowerCase().includes(query));

    const trimmedFilter = (filter || '').trim();
    if (trimmedFilter) {
      const hasExactMatch = options.some(o => o.text.toLowerCase() === trimmedFilter.toLowerCase());
      if (!hasExactMatch) {
        const label = addNewLabel ? addNewLabel(trimmedFilter) : trimmedFilter;
        filtered.push({ value: trimmedFilter, text: trimmedFilter, itemLabel: label });
      }
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'searchable-dropdown-empty';
      empty.textContent = 'No results';
      listbox.appendChild(empty);
      return;
    }

    filtered.forEach((opt, i) => {
      const item = document.createElement('div');
      item.className = 'searchable-dropdown-item';
      if (opt.value === selectedValue) item.classList.add('selected');
      if (i === highlightIdx) item.classList.add('highlighted');
      item.textContent = opt.itemLabel || opt.text;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent blur
        selectOption(opt.value, opt.text);
        close();
      });
      item.addEventListener('mouseenter', () => {
        highlightIdx = i;
        listbox.querySelectorAll('.searchable-dropdown-item').forEach((el, j) => {
          el.classList.toggle('highlighted', j === i);
        });
      });
      listbox.appendChild(item);
    });
  }

  function selectOption(val, text) {
    const changed = selectedValue !== val;
    selectedValue = val;
    selectedText = text;
    input.value = val ? text : '';
    input.title = input.value || placeholder || '';
    clearBtn.style.display = val ? 'flex' : 'none';
    if (changed) {
      wrapper.dispatchEvent(new Event('change', { bubbles: true }));
      wrapper.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    highlightIdx = -1;
    wrapper.classList.add('open');
    renderList(selectedValue ? '' : input.value);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    wrapper.classList.remove('open');
    // Restore display text
    if (allowFreeText && !selectedValue && input.value.trim()) {
      selectedValue = input.value.trim();
      selectedText = selectedValue;
    }
    input.value = selectedValue ? selectedText : '';
    clearBtn.style.display = input.value ? 'flex' : 'none';
  }

  input.addEventListener('focus', () => {
    input.select();
    open();
  });

  input.addEventListener('input', () => {
    highlightIdx = -1;
    if (!isOpen) open();
    renderList(input.value);
    clearBtn.style.display = input.value ? 'flex' : 'none';
    wrapper.dispatchEvent(new Event('input', { bubbles: true }));
  });

  input.addEventListener('blur', () => {
    close();
  });

  input.addEventListener('keydown', (e) => {
    const items = listbox.querySelectorAll('.searchable-dropdown-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) { open(); return; }
      highlightIdx = Math.min(highlightIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIdx));
      if (items[highlightIdx]) items[highlightIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIdx = Math.max(highlightIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('highlighted', i === highlightIdx));
      if (items[highlightIdx]) items[highlightIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < items.length) {
        items[highlightIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      } else if (items.length > 0) {
        items[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });

  clearBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectOption('', '');
    close();
  });

  arrow.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (isOpen) { close(); input.blur(); }
    else { input.focus(); if (!isOpen) open(); }
  });

  // Close when clicking outside
  document.addEventListener('mousedown', (e) => {
    if (!wrapper.contains(e.target)) close();
  });

  // Expose .value as getter/setter for drop-in compatibility with <select>
  Object.defineProperty(wrapper, 'value', {
    get() { return selectedValue; },
    set(val) {
      if (val === '' || val == null) {
        selectedValue = '';
        selectedText = '';
        input.value = '';
      } else {
        const match = options.find(o => o.value === val);
        selectedValue = val;
        selectedText = match ? match.text : val;
        input.value = selectedText;
      }
      input.title = input.value || placeholder || '';
      clearBtn.style.display = val ? 'flex' : 'none';
    }
  });

  Object.defineProperty(wrapper, 'searchText', {
    get() { return input.value; }
  });

  // Expose addEventListener on wrapper (already works since it's a div)
  return wrapper;
}

/**
 * Wraps a standard input or select element with a relative container
 * and appends a clear button (SVG cancel icon) that resets its value.
 * Toggles the visibility of the clear button based on whether the field has a value.
 *
 * @param {HTMLElement} element - The select or input element to wrap
 * @param {function} [onClear] - Optional callback triggered when the field is cleared
 * @returns {HTMLElement} The wrapper element containing the select/input and the clear button
 */
function wrapFilterFieldWithClear(element, onClear) {
  const wrapper = document.createElement('div');
  wrapper.className = 'filter-field-wrapper';
  
  let iconHtml = '';
  if (element.tagName === 'SELECT') {
    const text = element.options[0]?.text || '';
    if (text.includes('Work Request')) {
      iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>';
    } else if (text.includes('Status')) {
      iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    } else if (text.includes('Priority')) {
      iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    } else if (text.includes('Fund')) {
      iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>';
    } else if (text.includes('User')) {
      iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    }
  }

  if (iconHtml) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'filter-field-icon';
    iconSpan.innerHTML = iconHtml;
    wrapper.appendChild(iconSpan);
    wrapper.classList.add('has-icon');
  }

  if (element.style.maxWidth) wrapper.style.maxWidth = element.style.maxWidth;
  
  if (element.parentNode) {
    element.parentNode.insertBefore(wrapper, element);
  }
  wrapper.appendChild(element);
  
  const clearBtn = document.createElement('span');
  clearBtn.className = 'filter-field-clear';
  clearBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg>';
  clearBtn.style.display = 'none';
  wrapper.appendChild(clearBtn);
  
  function updateClearVisibility() {
    const hasVal = !!element.value;
    const isVisible = hasVal && !element.disabled;
    clearBtn.style.display = isVisible ? 'flex' : 'none';
    wrapper.classList.toggle('has-value', isVisible);
  }
  
  // Intercept the setter on the element's value property so programmatic changes update the button
  let proto = Object.getPrototypeOf(element);
  let descriptor = null;
  while (proto) {
    descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor) break;
    proto = Object.getPrototypeOf(proto);
  }
  
  if (descriptor && descriptor.set) {
    Object.defineProperty(element, 'value', {
      get() {
        return descriptor.get.call(element);
      },
      set(val) {
        descriptor.set.call(element, val);
        updateClearVisibility();
      },
      configurable: true
    });
  }

  // Intercept the setter on the element's disabled property so programmatic changes update the button
  let disabledProto = Object.getPrototypeOf(element);
  let disabledDescriptor = null;
  while (disabledProto) {
    disabledDescriptor = Object.getOwnPropertyDescriptor(disabledProto, 'disabled');
    if (disabledDescriptor) break;
    disabledProto = Object.getPrototypeOf(disabledProto);
  }
  
  if (disabledDescriptor && disabledDescriptor.set) {
    Object.defineProperty(element, 'disabled', {
      get() {
        return disabledDescriptor.get.call(element);
      },
      set(val) {
        disabledDescriptor.set.call(element, val);
        updateClearVisibility();
      },
      configurable: true
    });
  }
  
  element.addEventListener('input', updateClearVisibility);
  element.addEventListener('change', updateClearVisibility);
  
  clearBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (element.disabled) return;
    element.value = '';
    updateClearVisibility();
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    if (onClear) onClear();
  });
  
  // Initial check
  updateClearVisibility();
  
  // Expose value on wrapper for direct setting
  Object.defineProperty(wrapper, 'value', {
    get() { return element.value; },
    set(val) {
      element.value = val;
      updateClearVisibility();
    }
  });

  return wrapper;
}

function getChecklistItemTotalHours(item) {
  return (item.timeLogs || []).reduce((sum, log) => sum + (log.hours || 0), 0);
}

function getTaskTotalHours(task) {
  const taskLogs = (task.timeLogs || []).reduce((sum, log) => sum + (log.hours || 0), 0);
  const checklistLogs = (task.checklist || []).reduce((sum, item) => sum + getChecklistItemTotalHours(item), 0);
  return taskLogs + checklistLogs;
}

function isChecklistBlocked(item, checklist) {
  if (!item.dependsOn) return false;
  if (item.dependsOn === '*') {
    return (checklist || []).some(c => c.id !== item.id && !c.completed);
  }
  const prereq = (checklist || []).find(c => c.id === item.dependsOn);
  return !prereq || !prereq.completed;
}

function getIncompleteChecklistNames(task) {
  return (task.checklist || [])
    .filter(item => !item.completed && !isChecklistBlocked(item, task.checklist))
    .map(item => item.text);
}

function getTaskChecklistCompletion(task) {
  const list = task.checklist || [];
  const done = list.filter(i => i.completed).length;
  return { done, total: list.length, percent: list.length ? Math.round((done / list.length) * 100) : 0 };
}

/**
 * Return all distinct assignee names for a task: primary assigneeName plus
 * any coAssignees, falling back to resolving the registered user name from
 * assigneeId / assignedTo when no explicit name is stored.
 */
function getTaskAllAssigneeNames(task) {
  const names = new Set();
  if (task.assigneeName) names.add(task.assigneeName);
  (task.coAssignees || []).forEach(n => { if (n) names.add(n); });
  if (!task.assigneeName && (task.assigneeId || task.assignedTo)) {
    const u = window.apiClient?.userCache?.getById(task.assigneeId || task.assignedTo);
    if (u?.name) names.add(u.name);
  }
  return Array.from(names);
}

function manilaToday() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })).toISOString().slice(0, 10);
}

// ============================================================
// Notion-inspired Side Pane with view-mode options
// Supports: side-peek, center-peek, full-page, new-tab
// ============================================================

const PaneMode = {
  SIDE_PEEK: 'side-peek',
  CENTER_PEEK: 'center-peek',
  FULL_PAGE: 'full-page',
  NEW_TAB: 'new-tab'
};

const VALID_PANE_MODES = Object.values(PaneMode);

function getPaneDefault(viewContext) {
  if (!viewContext) return null;
  try {
    const stored = localStorage.getItem(`erp_pane_default_${viewContext}`);
    return VALID_PANE_MODES.includes(stored) ? stored : null;
  } catch (e) { return null; }
}

function setPaneDefault(viewContext, mode) {
  if (!viewContext || !VALID_PANE_MODES.includes(mode)) return;
  try { localStorage.setItem(`erp_pane_default_${viewContext}`, mode); } catch (e) {}
}

function getPaneWidth() {
  try {
    const w = localStorage.getItem('erp_pane_width');
    return w && !isNaN(parseInt(w, 10)) ? parseInt(w, 10) : null;
  } catch (e) { return null; }
}

function setPaneWidth(width) {
  try { localStorage.setItem('erp_pane_width', String(width)); } catch (e) {}
}

const PaneIcons = {
  sidePeek: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="15" y1="4" x2="15" y2="20"/></svg>',
  centerPeek: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/><line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/></svg>',
  fullPage: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="8" x2="22" y2="8"/></svg>',
  newTab: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h6v2H6v12h12v-4h2v6H4V4z"/><path d="M14 4h6v6"/><path d="M20 4l-8 8"/></svg>',
  editDefault: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  viewOptions: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>'
};

class SidePane {
  constructor() {
    this.overlay = null;
    this.pane = null;
    this.body = null;
    this.header = null;
    this.viewMenu = null;
    this.resizeHandle = null;
    this.activeElement = null;
    this.triggerElement = null;
    this.onCloseCallback = null;
    this.onExpandCallback = null;
    this.mode = PaneMode.SIDE_PEEK;
    this.viewContext = null;
    this.recordId = null;
    this.fullPageRoute = null;
    this.newTabRoute = null;
    this.previouslyFocused = null;
    this._lastContent = null;
    this.isResizing = false;
    this._ignoreNextClick = false;
    this._forceMode = null;
    this.init();
  }

  init() {
    let overlay = document.getElementById('global-side-pane-overlay');
    let pane = document.getElementById('global-side-pane');

    if (!overlay) {
      overlay = el('div', { id: 'global-side-pane-overlay', class: 'side-pane-overlay', 'aria-hidden': 'true' });
      document.body.appendChild(overlay);
      overlay.addEventListener('click', () => {
        if (this.mode === PaneMode.CENTER_PEEK) this.close();
      });
    }

    if (!pane) {
      pane = el('div', { id: 'global-side-pane', class: 'side-pane side-pane--side-peek', role: 'region' });
      document.body.appendChild(pane);
    }

    this.overlay = overlay;
    this.pane = pane;

    document.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') {
        if (this.viewMenu && this.viewMenu.classList.contains('open')) {
          this.hideViewMenu();
          return;
        }
        this.close();
      } else if (this.mode === PaneMode.CENTER_PEEK && e.key === 'Tab') {
        this.handleFocusTrap(e);
      }
    });

    document.addEventListener('click', (e) => {
      if (!this.isOpen()) return;
      if (this._ignoreNextClick) {
        this._ignoreNextClick = false;
        return;
      }
      const path = e.composedPath ? e.composedPath() : this.composedPathPolyfill(e.target);
      const clickedInsidePane = path.some(el => el === this.pane || el === this.viewMenu);
      const clickedTrigger = path.some(el => {
        if (!el || !el.classList) return false;
        if (el instanceof Element && (el.dataset?.paneTrigger === 'true' || el.closest('[data-pane-trigger]'))) return true;
        return el.classList.contains('board-card') ||
               el.classList.contains('board-card-v2') ||
               el.classList.contains('list-item') ||
               el.classList.contains('task-row') ||
               el.classList.contains('status-select') ||
               el.classList.contains('modal-overlay') ||
               el.classList.contains('modal') ||
               el.classList.contains('searchable-dropdown') ||
               el.classList.contains('mdp-wrapper') ||
               el.classList.contains('mtp-wrapper') ||
               el.classList.contains('mdp-overlay') ||
               el.classList.contains('mtp-overlay') ||
               el.classList.contains('sidebar') ||
               el.classList.contains('sidebar-collapse-btn') ||
               el.classList.contains('notion-embed-popover');
      });
      if (!clickedInsidePane && !clickedTrigger) this.close();
    });
  }

  composedPathPolyfill(target) {
    const path = [];
    let current = target;
    while (current) { path.push(current); current = current.parentNode; }
    path.push(document, window);
    return path;
  }

  isOpen() {
    return this.pane && this.pane.classList.contains('open');
  }

  resolveMode(opts) {
    if (this._forceMode && VALID_PANE_MODES.includes(this._forceMode)) return this._forceMode;
    if (opts.mode && VALID_PANE_MODES.includes(opts.mode)) return opts.mode;
    if (opts.viewContext) {
      const def = getPaneDefault(opts.viewContext);
      if (def) return def;
    }
    return PaneMode.SIDE_PEEK;
  }

  open(opts = {}) {
    const mode = this.resolveMode(opts);
    this.viewContext = opts.viewContext || null;
    this.recordId = opts.recordId || null;
    this.triggerElement = opts.triggerElement || null;
    this.fullPageRoute = opts.fullPageRoute || null;
    this.newTabRoute = opts.newTabRoute || null;
    this.onCloseCallback = opts.onClose || null;
    this.onExpandCallback = opts.onExpand || null;
    this._lastContent = opts.content || null;
    this._lastFooter = null;

    if (mode === PaneMode.FULL_PAGE) { this.goFullPage(); return; }
    if (mode === PaneMode.NEW_TAB) { this.goNewTab(); return; }

    if (this.isOpen() && this.mode !== mode) this.close({ silent: true });
    this.mode = mode;

    if (this.triggerElement) {
      this.activeElement = this.triggerElement;
      this.activeElement.classList.add('side-pane-active');
    }
    this.previouslyFocused = document.activeElement;

    this.render(mode);

    if (opts.title) {
      this.pane.setAttribute('aria-label', opts.title);
    }

    if (opts.content) {
      if (typeof opts.content === 'string') {
        console.warn('SidePane.open received string content; rejecting for security. Pass an HTMLElement or DocumentFragment.');
        this.body.innerHTML = '';
        this.body.appendChild(renderEmptyState('Unable to load panel content'));
      } else {
        this.body.innerHTML = '';
        
        // Find any footer in the content and move it directly to this.pane
        const footer = opts.content.querySelector('.side-pane-form-footer, .side-pane-footer');
        if (footer) {
          footer.remove();
          this._lastFooter = footer;
          this.body.appendChild(opts.content);
          this.pane.appendChild(footer);
        } else {
          this.body.appendChild(opts.content);
        }
      }
    } else {
      this.body.innerHTML = '';
    }

    this._ignoreNextClick = true;
    setTimeout(() => { this._ignoreNextClick = false; }, 0);

    requestAnimationFrame(() => {
      this.overlay.classList.toggle('open', this.mode === PaneMode.CENTER_PEEK);
      this.pane.classList.remove('side-pane--side-peek', 'side-pane--center-peek');
      this.pane.classList.add(this.mode === PaneMode.CENTER_PEEK ? 'side-pane--center-peek' : 'side-pane--side-peek');
      this.pane.classList.add('open');
      // Center-peek forms focus the title input first; other center-peek content
      // falls back to the first focusable element in the panel.
      if (this.mode === PaneMode.CENTER_PEEK) this.trapFocus('.notion-title-input');
    });
  }

  render(mode) {
    this.pane.innerHTML = '';

    if (mode === PaneMode.SIDE_PEEK) {
      this.resizeHandle = el('div', { class: 'side-pane-resize-handle', title: 'Resize panel', 'aria-label': 'Resize panel' });
      this.resizeHandle.addEventListener('mousedown', (e) => this.startResize(e));
      this.pane.appendChild(this.resizeHandle);
      this.applyPersistedWidth();
    }

    this.header = el('div', { class: 'side-pane-header' });
    const headerLeft = el('div', { class: 'side-pane-header-left' });

    const closeBtn = el('button', {
      class: 'side-pane-close-btn',
      title: 'Close (Esc)',
      'aria-label': 'Close panel',
      html: '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5"/></svg>'
    });
    closeBtn.addEventListener('click', () => this.close());
    headerLeft.appendChild(closeBtn);
    this.header.appendChild(headerLeft);

    const headerRight = el('div', { class: 'side-pane-header-right' });

    const hasFullPage = this.fullPageRoute || this.onExpandCallback;
    if (hasFullPage) {
      const expandBtn = el('button', {
        class: 'side-pane-expand-btn',
        title: 'Open as full page',
        'aria-label': 'Open as full page',
        html: '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>'
      });
      expandBtn.addEventListener('click', () => this.goFullPage());
      headerRight.appendChild(expandBtn);
    }

    const viewMenuBtn = el('button', {
      class: 'side-pane-view-menu-btn',
      title: 'View options',
      'aria-label': 'View options',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      html: PaneIcons.viewOptions
    });
    viewMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleViewMenu();
    });
    headerRight.appendChild(viewMenuBtn);
    this.header.appendChild(headerRight);

    this.pane.appendChild(this.header);

    this.body = el('div', { class: 'side-pane-body' });
    this.pane.appendChild(this.body);

    this.viewMenu = this.buildViewMenu();
    this.pane.appendChild(this.viewMenu);
  }

  buildViewMenu() {
    const menu = el('div', { class: 'side-pane-view-menu', 'aria-hidden': 'true' });

    // Header label — mirrors Notion's "Open as" / "View options" wording.
    const header = el('div', { class: 'side-pane-view-menu-header', text: 'Open form as' });
    menu.appendChild(header);

    const viewItems = [
      { key: PaneMode.SIDE_PEEK, label: 'Side peek', icon: PaneIcons.sidePeek },
      { key: PaneMode.CENTER_PEEK, label: 'Center peek', icon: PaneIcons.centerPeek },
      { key: PaneMode.FULL_PAGE, label: 'Full page', icon: PaneIcons.fullPage },
      { key: PaneMode.NEW_TAB, label: 'New tab', icon: PaneIcons.newTab }
    ];

    viewItems.forEach(item => {
      const row = el('button', {
        class: 'side-pane-view-menu-item',
        type: 'button',
        'data-mode': item.key,
        html: `<span class="side-pane-view-menu-icon">${item.icon}</span><span class="side-pane-view-menu-label">${item.label}</span>`
      });
      if (this.mode === item.key) row.classList.add('active');
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.switchMode(item.key);
      });
      menu.appendChild(row);
    });

    menu.appendChild(el('div', { class: 'side-pane-view-menu-divider' }));

    // "Edit view default" opens an inline submenu of the same four options.
    // This is the Notion-style behavior: pick which of the available view modes
    // should be used automatically the next time this form context opens.
    const defaultRow = el('button', {
      class: 'side-pane-view-menu-item',
      type: 'button',
      html: `<span class="side-pane-view-menu-icon">${PaneIcons.editDefault}</span><span class="side-pane-view-menu-label">Set default view</span>`
    });
    defaultRow.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleViewDefaultSubmenu(menu, viewItems);
    });
    menu.appendChild(defaultRow);

    // Container for the default-submenu (rendered on demand).
    this._defaultSubmenu = el('div', { class: 'side-pane-view-default-submenu hidden' });
    menu.appendChild(this._defaultSubmenu);

    return menu;
  }

  toggleViewDefaultSubmenu(menu, viewItems) {
    const submenu = this._defaultSubmenu;
    if (!submenu) return;
    const isOpen = !submenu.classList.contains('hidden');
    if (isOpen) {
      submenu.classList.add('hidden');
      submenu.innerHTML = '';
      return;
    }

    submenu.innerHTML = '';
    submenu.classList.remove('hidden');

    const storedDefault = this.viewContext ? getPaneDefault(this.viewContext) : null;
    const header = el('div', { class: 'side-pane-view-menu-header', text: 'Default view for this form' });
    submenu.appendChild(header);

    viewItems.forEach(item => {
      const row = el('button', {
        class: 'side-pane-view-menu-item',
        type: 'button',
        'data-mode': item.key,
        html: `<span class="side-pane-view-menu-icon">${item.icon}</span><span class="side-pane-view-menu-label">${item.label}</span>${storedDefault === item.key ? ' <span class="side-pane-view-menu-check">✓</span>' : ''}`
      });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.viewContext) {
          setPaneDefault(this.viewContext, item.key);
          // Provide immediate visual feedback by re-rendering the submenu.
          this.toggleViewDefaultSubmenu(menu, viewItems);
          this.toggleViewDefaultSubmenu(menu, viewItems);
        }
      });
      submenu.appendChild(row);
    });

    const clearRow = el('button', {
      class: 'side-pane-view-menu-item',
      type: 'button',
      html: '<span class="side-pane-view-menu-icon"></span><span class="side-pane-view-menu-label">Reset to side peek</span>'
    });
    clearRow.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.viewContext) {
        try { localStorage.removeItem(`erp_pane_default_${this.viewContext}`); } catch (e) {}
        this.toggleViewDefaultSubmenu(menu, viewItems);
        this.toggleViewDefaultSubmenu(menu, viewItems);
      }
    });
    submenu.appendChild(clearRow);
  }

  switchMode(newMode) {
    if (!VALID_PANE_MODES.includes(newMode)) return;
    if (newMode === PaneMode.FULL_PAGE) { this.hideViewMenu(); this.goFullPage(); return; }
    if (newMode === PaneMode.NEW_TAB) { this.hideViewMenu(); this.goNewTab(); return; }

    this.mode = newMode;
    this.render(newMode);
    if (this._lastContent && this._lastContent instanceof Node) {
      this.body.innerHTML = '';
      this.body.appendChild(this._lastContent);
    }
    if (this._lastFooter && this._lastFooter instanceof Node) {
      this.pane.appendChild(this._lastFooter);
    }
    requestAnimationFrame(() => {
      this.overlay.classList.toggle('open', this.mode === PaneMode.CENTER_PEEK);
      this.pane.classList.remove('side-pane--side-peek', 'side-pane--center-peek');
      this.pane.classList.add(this.mode === PaneMode.CENTER_PEEK ? 'side-pane--center-peek' : 'side-pane--side-peek');
      this.pane.classList.add('open');
      this.updateViewMenuActiveState();
      if (this.mode === PaneMode.CENTER_PEEK) this.trapFocus('.notion-title-input');
    });
  }

  updateViewMenuActiveState() {
    if (!this.viewMenu) return;
    this.viewMenu.querySelectorAll('.side-pane-view-menu-item[data-mode]').forEach(item => {
      item.classList.toggle('active', item.dataset.mode === this.mode);
    });
  }

  toggleViewMenu() {
    if (!this.viewMenu) return;
    if (this.viewMenu.classList.contains('open')) this.hideViewMenu();
    else this.showViewMenu();
  }

  showViewMenu() {
    this.viewMenu.classList.add('open');
    this.viewMenu.setAttribute('aria-hidden', 'false');
    const btn = this.header?.querySelector('.side-pane-view-menu-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  hideViewMenu() {
    if (!this.viewMenu) return;
    this.viewMenu.classList.remove('open');
    this.viewMenu.setAttribute('aria-hidden', 'true');
    const btn = this.header?.querySelector('.side-pane-view-menu-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  goFullPage() {
    this.close({ silent: true });
    this.recordId = null;
    if (this.onExpandCallback) {
      this.onExpandCallback();
    } else if (this.fullPageRoute) {
      // Force the next route resolve to render the full-page layout even when
      // the user's default view is side-peek. This makes the "Full page" menu
      // item a one-time navigation rather than requiring a default change.
      // Keep the override around long enough for the asynchronous hashchange
      // event that follows location.hash assignment to also see it.
      this._forceMode = PaneMode.FULL_PAGE;
      location.hash = this.fullPageRoute;
      const appRef = (typeof window !== 'undefined' && window.App) || (typeof App !== 'undefined' ? App : null);
      if (appRef && typeof appRef.handleRoute === 'function') appRef.handleRoute();
      setTimeout(() => { this._forceMode = null; }, 0);
    } else {
      console.warn('SidePane: full-page requested but no route or onExpand provided.');
    }
  }

  goNewTab() {
    const route = this.newTabRoute || this.fullPageRoute;
    if (!route) {
      console.warn('SidePane: new-tab requested but no route provided.');
      return;
    }
    window.open(location.origin + location.pathname + route, '_blank', 'noopener,noreferrer');
  }

  startResize(e) {
    if (this.mode !== PaneMode.SIDE_PEEK) return;
    e.preventDefault();
    this.isResizing = true;
    this.resizeHandle.classList.add('active');
    this.pane.classList.add('resizing');
    const startX = e.clientX;
    const startWidth = this.pane.getBoundingClientRect().width;
    const minWidth = 420;
    const maxWidth = Math.min(window.innerWidth * 0.85, 1200);

    const onMove = (ev) => {
      if (!this.isResizing) return;
      const delta = startX - ev.clientX;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
      this.pane.style.width = newWidth + 'px';
      this.pane.style.setProperty('--pane-width', newWidth + 'px');
    };
    const onUp = () => {
      if (!this.isResizing) return;
      this.isResizing = false;
      this.resizeHandle.classList.remove('active');
      this.pane.classList.remove('resizing');
      setPaneWidth(this.pane.getBoundingClientRect().width);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  applyPersistedWidth() {
    const width = getPaneWidth();
    if (width) {
      this.pane.style.width = width + 'px';
      this.pane.style.setProperty('--pane-width', width + 'px');
    } else {
      this.pane.style.width = '';
      this.pane.style.setProperty('--pane-width', '50vw');
    }
  }

  trapFocus(preferredSelector) {
    // For center-peek forms, try to focus the title input first so the user lands
    // directly on the primary editable area instead of the close button.
    if (preferredSelector) {
      const preferred = this.pane.querySelector(preferredSelector);
      if (preferred && typeof preferred.focus === 'function' && preferred.offsetParent !== null) {
        preferred.focus();
        return;
      }
    }
    const focusable = this.getFocusableElements();
    if (focusable.length) focusable[0].focus();
  }

  getFocusableElements() {
    return Array.from(this.pane.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.disabled && el.offsetParent !== null && !el.closest('.side-pane-view-menu'));
  }

  handleFocusTrap(e) {
    const focusable = this.getFocusableElements();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  close(opts = {}) {
    if (!this.isOpen()) return;
    this.overlay.classList.remove('open');
    this.pane.classList.remove('open');
    this.hideViewMenu();

    if (this.activeElement) {
      this.activeElement.classList.remove('side-pane-active');
      this.activeElement = null;
    }

    if (this.mode === PaneMode.CENTER_PEEK && this.previouslyFocused && typeof this.previouslyFocused.focus === 'function') {
      try { this.previouslyFocused.focus(); } catch (e) {}
    }

    this.mode = PaneMode.SIDE_PEEK;
    this._lastContent = null;
    this._lastFooter = null;

    if (this.onCloseCallback && !opts.silent) {
      const cb = this.onCloseCallback;
      this.onCloseCallback = null;
      cb();
    }
  }
}

window.SidePaneInstance = new SidePane();

/**
 * Focus the first empty `.notion-title-input` inside a form container.
 * Used so creation forms auto-focus their title field as soon as they open.
 *
 * @param {HTMLElement} container
 */
function focusFormTitle(container) {
  if (!container) return;
  const titleInput = container.querySelector('.notion-title-input');
  if (titleInput && !titleInput.value.trim() && typeof titleInput.focus === 'function') {
    setTimeout(() => {
      titleInput.focus();
    }, 60);
  }
}

/**
 * Builds a standard full-page form breadcrumb title bar.
 *
 * @param {Object} opts
 * @param {string} opts.baseLabel - Clickable breadcrumb root text (e.g. 'Clients')
 * @param {string} opts.baseHash - Hash route for the root (e.g. '#clients')
 * @param {string} opts.currentText - Non-clickable current page text (e.g. 'Add Client')
 * @param {Array<{text: string, class: string, type?: string, onClick?: Function, id?: string}>} [opts.actions] - Buttons on the right
 * @returns {HTMLElement}
 * @param {HTMLElement} [opts.viewSwitcher] - Optional shared form view-mode switcher (e.g. from buildFormViewSwitcher).
 */
function buildFormBreadcrumb({ baseLabel, baseHash, currentText, actions = [], viewSwitcher = null }) {
  const titleBar = el('div', { class: 'page-title-bar-v2' });
  const h1 = el('h1', { class: 'breadcrumb-h1' });
  const baseLink = el('a', { href: 'javascript:void(0)', class: 'breadcrumb-base', text: baseLabel });
  baseLink.addEventListener('click', () => { location.hash = baseHash; });
  h1.appendChild(baseLink);
  h1.appendChild(el('span', { class: 'breadcrumb-sep', text: ' / ' }));
  h1.appendChild(document.createTextNode(currentText));
  titleBar.appendChild(h1);

  if (actions.length > 0 || viewSwitcher) {
    const actionsBar = el('div', { class: 'actions-bar' });
    if (viewSwitcher) {
      viewSwitcher.classList.add('breadcrumb-view-switcher');
      actionsBar.appendChild(viewSwitcher);
    }
    actions.forEach(a => {
      const btn = el('button', {
        type: a.type || 'button',
        class: a.class || 'btn btn-secondary',
        text: a.text
      });
      if (a.form) btn.setAttribute('form', a.form);
      if (a.id) btn.id = a.id;
      if (a.testId) btn.setAttribute('data-testid', a.testId);
      if (a.onClick) btn.addEventListener('click', a.onClick);
      actionsBar.appendChild(btn);
    });
    titleBar.appendChild(actionsBar);
  }

  return titleBar;
}

/**
 * Builds a Notion-style popup view-mode switcher for full-page forms.
 * Mirrors the popup inside the shared side-peek panel: "Open form as",
 * Side peek / Center peek / Full page / New tab, plus "Set default view".
 *
 * @param {Object} opts
 * @param {string} [opts.currentMode] - 'side-peek' | 'center-peek' | 'full-page' | 'new-tab'
 * @param {Function} [opts.onSidePeek] - Callback when Side peek is selected
 * @param {Function} [opts.onCenterPeek] - Callback when Center peek is selected
 * @param {Function} [opts.onFullPage] - Callback when Full page is selected
 * @param {Function} [opts.onNewTab] - Callback when New tab is selected
 * @param {string} [opts.viewContext] - Context used to store the default view preference
 * @returns {HTMLElement}
 */
function buildFormViewSwitcher({
  currentMode = PaneMode.FULL_PAGE,
  onSidePeek,
  onCenterPeek,
  onFullPage,
  onNewTab,
  viewContext = 'form'
}) {
  const wrapper = el('div', {
    class: 'form-view-switcher',
    title: `Form view: ${viewContext}`
  });

  const toggleBtn = el('button', {
    type: 'button',
    class: 'form-view-switcher-btn',
    title: 'View options',
    'aria-label': 'View options',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    html: PaneIcons.viewOptions
  });
  wrapper.appendChild(toggleBtn);

  const menu = el('div', {
    class: 'side-pane-view-menu form-view-switcher-menu',
    'aria-hidden': 'true'
  });

  const header = el('div', { class: 'side-pane-view-menu-header', text: 'Open form as' });
  menu.appendChild(header);

  const viewItems = [
    { key: PaneMode.SIDE_PEEK, label: 'Side peek', icon: PaneIcons.sidePeek, onClick: onSidePeek },
    { key: PaneMode.CENTER_PEEK, label: 'Center peek', icon: PaneIcons.centerPeek, onClick: onCenterPeek },
    { key: PaneMode.FULL_PAGE, label: 'Full page', icon: PaneIcons.fullPage, onClick: onFullPage },
    { key: PaneMode.NEW_TAB, label: 'New tab', icon: PaneIcons.newTab, onClick: onNewTab }
  ];

  viewItems.forEach(item => {
    const row = el('button', {
      type: 'button',
      class: 'side-pane-view-menu-item' + (item.key === currentMode ? ' active' : ''),
      'data-mode': item.key,
      html: `<span class="side-pane-view-menu-icon">${item.icon}</span><span class="side-pane-view-menu-label">${item.label}</span>`
    });
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      if (item.key !== currentMode && item.onClick) item.onClick();
    });
    menu.appendChild(row);
  });

  menu.appendChild(el('div', { class: 'side-pane-view-menu-divider' }));

  const defaultRow = el('button', {
    type: 'button',
    class: 'side-pane-view-menu-item',
    html: `<span class="side-pane-view-menu-icon">${PaneIcons.editDefault}</span><span class="side-pane-view-menu-label">Set default view</span>`
  });
  const submenu = el('div', { class: 'side-pane-view-default-submenu hidden' });

  function buildDefaultSubmenu() {
    submenu.innerHTML = '';
    const storedDefault = viewContext ? getPaneDefault(viewContext) : null;

    submenu.appendChild(el('div', {
      class: 'side-pane-view-menu-header',
      text: 'Default view for this form'
    }));

    viewItems.forEach(item => {
      const row = el('button', {
        type: 'button',
        class: 'side-pane-view-menu-item',
        'data-mode': item.key,
        html: `<span class="side-pane-view-menu-icon">${item.icon}</span><span class="side-pane-view-menu-label">${item.label}</span>${storedDefault === item.key ? ' <span class="side-pane-view-menu-check">✓</span>' : ''}`
      });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (viewContext) {
          setPaneDefault(viewContext, item.key);
          toggleDefaultSubmenu();
          toggleDefaultSubmenu();
        }
      });
      submenu.appendChild(row);
    });

    const clearRow = el('button', {
      type: 'button',
      class: 'side-pane-view-menu-item',
      html: '<span class="side-pane-view-menu-icon"></span><span class="side-pane-view-menu-label">Reset to side peek</span>'
    });
    clearRow.addEventListener('click', (e) => {
      e.stopPropagation();
      if (viewContext) {
        try { localStorage.removeItem(`erp_pane_default_${viewContext}`); } catch (e) {}
        toggleDefaultSubmenu();
        toggleDefaultSubmenu();
      }
    });
    submenu.appendChild(clearRow);
  }

  function toggleDefaultSubmenu() {
    const isOpen = !submenu.classList.contains('hidden');
    if (isOpen) {
      submenu.classList.add('hidden');
      submenu.innerHTML = '';
    } else {
      buildDefaultSubmenu();
      submenu.classList.remove('hidden');
    }
  }

  defaultRow.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDefaultSubmenu();
  });
  menu.appendChild(defaultRow);
  menu.appendChild(submenu);
  wrapper.appendChild(menu);

  function openMenu() {
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
    toggleBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', outsideClick);
  }

  function closeMenu() {
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    toggleBtn.setAttribute('aria-expanded', 'false');
    submenu.classList.add('hidden');
    submenu.innerHTML = '';
    document.removeEventListener('click', outsideClick);
  }

  function outsideClick(e) {
    if (!wrapper.contains(e.target)) closeMenu();
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('open')) closeMenu(); else openMenu();
  });

  return wrapper;
}

/**
 * Opens a form inside the side panel with Notion-style layout:
 * optional icon + title at top, form content in body, action buttons in sticky footer.
 *
 * View-mode routing notes:
 * - side-peek  (default): slides the panel in from the right; keeps the list visible.
 * - center-peek: opens a centered modal-like panel with a dimmed overlay.
 * - full-page: navigates to #module/form/:id via location.hash; App.handleRoute() renders
 *   the form inline in the main content area. Requires the caller to provide fullPageRoute.
 * - new-tab: opens fullPageRoute in a new browser tab.
 *
 * Per-module full-page routes implemented in this branch:
 *   #operations/form/new | #operations/form/:id
 *   #operations/templateForm/new | #operations/templateForm/:id
 *   #billing/form/new | #billing/form/:id
 *   #disbursement/form/new | #disbursement/form/:id
 *   #transmittal/form/new | #transmittal/form/:id
 *   #clients/form/new | #clients/form/:id
 *
 * @param {Object} opts
 * @param {string|null} [opts.icon] - Emoji icon for the title; pass null to suppress the header
 * @param {string|null} [opts.title] - Panel title text; pass null to suppress the header
 * @param {HTMLElement} opts.formContent - The rendered form DOM (from renderForm())
 * @param {string} opts.formId - The form element's ID to find within the content
 * @param {Array<{text: string, class: string, type?: string, onClick?: Function}>} opts.actions - Footer buttons
 * @param {string} [opts.mode] - 'side-peek' | 'center-peek' | 'full-page' | 'new-tab'
 * @param {string} [opts.viewContext] - context for default persistence, e.g. 'client-form'
 * @param {string} [opts.fullPageRoute] - hash route for full-page / new-tab, e.g. '#clients/form/new'
 * @param {string} [opts.newTabRoute] - optional override for new-tab URL
 */
function openFormPanel({ icon, title, formContent, formId, actions, mode, viewContext, fullPageRoute, newTabRoute }) {
  const context = viewContext || (formId ? formId.replace(/-form$/, '') : 'form');

  if (mode === PaneMode.FULL_PAGE || mode === PaneMode.NEW_TAB) {
    const route = newTabRoute || fullPageRoute;
    if (route) {
      if (mode === PaneMode.FULL_PAGE) {
        location.hash = route;
        const appRef = (typeof window !== 'undefined' && window.App) || (typeof App !== 'undefined' ? App : null);
        if (appRef && typeof appRef.handleRoute === 'function') appRef.handleRoute();
      } else {
        window.open(location.origin + location.pathname + route, '_blank', 'noopener,noreferrer');
      }
    } else {
      console.warn('openFormPanel: full-page/new-tab requested without fullPageRoute/newTabRoute.');
    }
    return;
  }

  const wrapper = el('div');

  // Header icon/title is optional. Callers that want a clean Notion-style form
  // surface can pass icon: null and title: null / ''.
  const effectiveIcon = icon === undefined ? '📝' : icon;
  const showHeader = !!(effectiveIcon || (title && title.trim()));

  if (showHeader) {
    const titleSec = el('div', { class: 'side-pane-form-title' });
    if (effectiveIcon) {
      titleSec.appendChild(el('div', { class: 'side-pane-icon', text: effectiveIcon }));
    }
    if (title && title.trim()) {
      titleSec.appendChild(el('h2', { text: title }));
    }
    wrapper.appendChild(titleSec);
  }

  const contentArea = el('div', { class: 'side-pane-form-content' });
  formContent.classList.add('side-pane-form-wrapper');
  contentArea.appendChild(formContent);
  wrapper.appendChild(contentArea);

  if (actions && actions.length > 0) {
    const footer = el('div', { class: 'side-pane-form-footer' });
    actions.forEach(a => {
      const btn = el('button', { type: a.type || 'button', class: a.class || 'btn btn-secondary', text: a.text });
      if (a.form) btn.setAttribute('form', a.form);
      if (a.id) btn.id = a.id;
      if (a.testId) btn.setAttribute('data-testid', a.testId);
      if (a.onClick) btn.addEventListener('click', a.onClick);
      footer.appendChild(btn);
    });
    wrapper.appendChild(footer);
  }

  if (window.SidePaneInstance && typeof window.SidePaneInstance.open === 'function') {
    window.SidePaneInstance.open({
      title,
      content: wrapper,
      mode,
      viewContext: context,
      fullPageRoute,
      newTabRoute
    });
  }

  focusFormTitle(wrapper);
}

/**
 * Lightweight, non-blocking toast fallback used when Workflow.showMessage is
 * unavailable (e.g. during very early loads or outside module contexts).
 *
 * @param {string} title
 * @param {string} message
 * @param {string} [type='success']
 */
function showToast(title, message, type = 'success') {
  if (typeof Workflow !== 'undefined' && typeof Workflow.showMessage === 'function') {
    Workflow.showMessage(title, message, type);
    return;
  }

  let container = document.getElementById('utils-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'utils-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `utils-toast utils-toast-${type}`;
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(message)}</div>`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/**
 * Skeleton helpers used by the route loading overlay.
 */
function skeletonCard() {
  return '<div class="skeleton skeleton-card"></div>';
}

function skeletonRow(count = 1) {
  return Array.from({ length: count })
    .map(() => '<div class="skeleton skeleton-row"></div>')
    .join('');
}

function skeletonText(width = '100%') {
  return `<span class="skeleton skeleton-text" style="width:${width}"></span>`;
}

function skeletonAvatar() {
  return '<span class="skeleton skeleton-avatar"></span>';
}

function renderRouteSkeleton(routeName) {
  const base = (routeName || '').split('/')[0].replace('#', '');
  const isDetail = routeName.includes('/detail/');
  const isForm = routeName.includes('/form/') || routeName.includes('/templateForm/');

  if (isForm) {
    return `
      <div class="route-loading-overlay">
        <div class="route-skeleton-pane">
          ${skeletonText('40%')}
          ${skeletonRow(8)}
        </div>
      </div>`;
  }

  if (isDetail) {
    return `
      <div class="route-loading-overlay">
        <div class="route-skeleton-pane">
          ${skeletonText('35%')}
          ${skeletonCard()}
          ${skeletonRow(6)}
        </div>
      </div>`;
  }

  // Dashboard defaults to a card grid; everything else uses a list skeleton.
  if (base === 'dashboard') {
    return `
      <div class="route-loading-overlay">
        <div class="route-skeleton-pane">
          ${skeletonText('25%')}
          <div class="route-skeleton-grid">${skeletonCard()}${skeletonCard()}${skeletonCard()}${skeletonCard()}</div>
          ${skeletonRow(4)}
        </div>
      </div>`;
  }

  // Default list skeleton for clients, operations, billing, disbursement, etc.
  return `
    <div class="route-loading-overlay">
      <div class="route-skeleton-pane">
        <div class="route-skeleton-header">${skeletonText('30%')}</div>
        ${skeletonRow(10)}
      </div>
    </div>`;
}

window.Utils = {
  escapeHtml,
  showToast,
  skeletonCard,
  skeletonRow,
  skeletonText,
  skeletonAvatar,
  renderRouteSkeleton,
  nextInvoiceNumber,
  generateTrackingNumber
};

/**
 * Centralized helper to keep client-side caches in sync without a full page
 * reload. Invalidates the relevant caches, re-runs the router, and shows an
 * optional success toast immediately.
 *
 * @param {string} hash - Optional target hash (e.g. '#billing')
 * @param {Object} messageConfig - Optional toast success message config
 */
function triggerSyncReload(hash, messageConfig) {
  // Invalidate common caches so the next render picks up fresh data.
  try {
    if (typeof window.apiClient !== 'undefined') {
      if (window.apiClient.userCache && typeof window.apiClient.userCache.invalidate === 'function') {
        window.apiClient.userCache.invalidate();
      }
      if (window.apiClient.clientCache && typeof window.apiClient.clientCache.invalidate === 'function') {
        window.apiClient.clientCache.invalidate();
      }
      if (window.apiClient.workRequestCache && typeof window.apiClient.workRequestCache.invalidate === 'function') {
        window.apiClient.workRequestCache.invalidate();
      }
      // Invalidate module-level caches so writes/entity switches show fresh data.
      if (typeof Dashboard !== 'undefined' && typeof Dashboard.invalidateCache === 'function') {
        Dashboard.invalidateCache();
      }
      if (typeof WorkflowData !== 'undefined' && typeof WorkflowData.invalidate === 'function') {
        WorkflowData.invalidate();
      }
      if (typeof window.apiClient.abortRequests === 'function') {
        window.apiClient.abortRequests('sync-reload');
      }
    }
  } catch (e) {
    console.warn('triggerSyncReload cache cleanup failed:', e);
  }

  const appRef = (typeof window !== 'undefined' && window.App) || (typeof App !== 'undefined' ? App : null);
  if (hash && location.hash !== hash) {
    location.hash = hash;
    // hashchange will invoke App.handleRoute(); no need to call it directly.
  } else if (appRef && typeof appRef.handleRoute === 'function') {
    appRef.handleRoute();
  }

  if (messageConfig) {
    // Prefer an immediate toast; keep sessionStorage as a fallback for listeners.
    try {
      sessionStorage.removeItem('pending_toast');
      showToast(messageConfig.title, messageConfig.message, messageConfig.type || 'success');
    } catch (e) {
      sessionStorage.setItem('pending_toast', JSON.stringify(messageConfig));
    }
  }

  sessionStorage.removeItem('is_syncing');
}

/**
 * Safely closes the side panel (if initialized), updates the location hash,
 * and triggers global module re-routing to sync the lists underneath.
 *
 * @param {string} hash - The URL hash path to navigate to (e.g. '#billing')
 * @param {Object} [messageConfig] - Optional toast success message config.
 */
function closeFormPanelAndRoute(hash, messageConfig) {
  if (window.SidePaneInstance && typeof window.SidePaneInstance.close === 'function') {
    window.SidePaneInstance.close();
  }

  if (messageConfig) {
    triggerSyncReload(hash, messageConfig);
  } else {
    if (hash) {
      location.hash = hash;
    }
    const appRef = (typeof window !== 'undefined' && window.App) || (typeof App !== 'undefined' ? App : null);
    if (appRef && typeof appRef.handleRoute === 'function') {
      appRef.handleRoute();
    }
  }
}

/**
 * Utility to compose CSS class strings from strings, numbers, arrays, or objects.
 * Supports string primitives ('foo'), conditional objects ({ foo: true, bar: false }),
 * and nested arrays without relying on Array.prototype.flat.
 */
function classNames(...args) {
  const classes = [];
  for (const arg of args) {
    if (!arg) continue;
    const type = typeof arg;
    if (type === 'string' || type === 'number') {
      classes.push(arg);
    } else if (Array.isArray(arg)) {
      if (arg.length > 0) {
        const inner = classNames(...arg);
        if (inner) classes.push(inner);
      }
    } else if (type === 'object') {
      for (const key in arg) {
        if (Object.prototype.hasOwnProperty.call(arg, key) && arg[key]) {
          classes.push(key);
        }
      }
    }
  }
  return classes.join(' ');
}

/**
 * Creates a compact Jira-style two-pane filter toolbar.
 * Used system-wide across Operations, Billing, Disbursement, Transmittal, DMS, Users, etc.
 */
function createJiraFilterToolbar(config) {
  const {
    moduleName,
    categories,
    activeFilters,
    onFilterChange,
    viewMode,
    onViewModeChange,
    groupByOptions,
    currentGroupBy,
    onGroupByChange,
    searchConfig,
    sortOptions,
    currentSort,
    onSortChange
  } = config;

  const container = el('div', { class: 'jira-toolbar-sticky-container filters-bar' });
  const toolbar = el('div', { class: 'jira-toolbar' });

  let activeViewMode = viewMode || 'table';
  let groupWrap = null;

  // 1. View Mode Toggle
  if (viewMode && onViewModeChange) {
    const vmToggle = el('div', { class: 'view-mode-toggle' });
    const modes = [
      { key: 'table', label: 'Table', icon: typeof ViewIcons !== 'undefined' ? ViewIcons.table : '' },
      { key: 'board', label: 'Board', icon: typeof ViewIcons !== 'undefined' ? ViewIcons.board : '' },
      { key: 'list', label: 'List', icon: typeof ViewIcons !== 'undefined' ? ViewIcons.list : '' }
    ];
    const vmButtons = [];
    const renderViewModeToggle = () => {
      vmButtons.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-mode') === activeViewMode));
    };
    modes.forEach(m => {
      const btn = el('button', {
        type: 'button',
        html: m.icon + ' ' + m.label,
        class: activeViewMode === m.key ? 'active' : '',
        'data-mode': m.key
      });
      btn.addEventListener('click', () => {
        activeViewMode = m.key;
        onViewModeChange(m.key);
        renderViewModeToggle();
        if (groupWrap) groupWrap.classList.toggle('hidden', activeViewMode !== 'board');
      });
      vmButtons.push(btn);
      vmToggle.appendChild(btn);
    });
    toolbar.appendChild(vmToggle);
  }

  // 2. Filter Wrap & Dropdown
  const filterWrap = el('div', { class: 'jira-filter-wrap' });
  const filterTrigger = el('button', {
    type: 'button',
    class: 'jira-filter-trigger',
    html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="11" y2="16"/></svg> Filter'
  });
  const filterBadge = el('span', { class: 'jira-filter-badge hidden' });
  filterTrigger.appendChild(filterBadge);
  const filterDropdown = el('div', { class: 'jira-dropdown jira-filter-dropdown hidden' });

  const getActiveFilterCount = () => Object.values(activeFilters).reduce((sum, set) => sum + (set ? set.size : 0), 0);

  let selectedCategory = Object.keys(categories)[0];

  const renderFilterValues = () => {
    const catConfig = categories[selectedCategory];
    if (!catConfig) return;
    const options = typeof catConfig.getOptions === 'function' ? catConfig.getOptions() : [];
    const list = filterDropdown.querySelector('.jira-filter-values-list');
    if (!list) return;
    list.innerHTML = '';

    const searchInput = filterDropdown.querySelector('.jira-filter-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    let visibleCount = 0;
    const allOptions = options.slice();

    if (catConfig.hasDatePicker || catConfig.hasDateInput) {
      const dateWrap = el('div', { class: 'jira-filter-select-date-wrap' });
      let activeCustomDate = '';
      if (activeFilters[selectedCategory]) {
        activeFilters[selectedCategory].forEach(val => {
          if (val.startsWith('DATE:')) activeCustomDate = val.slice(5);
        });
      }

      const dateInput = el('input', {
        type: 'date',
        class: 'jira-filter-date-input',
        value: activeCustomDate || ''
      });

      dateInput.addEventListener('change', (e) => {
        e.stopPropagation();
        const val = dateInput.value;
        if (activeFilters[selectedCategory]) {
          Array.from(activeFilters[selectedCategory]).forEach(v => {
            if (v.startsWith('DATE:')) activeFilters[selectedCategory].delete(v);
          });
          if (val) activeFilters[selectedCategory].add(`DATE:${val}`);
        }
        updateFilterUI();
        if (onFilterChange) onFilterChange();
      });

      dateWrap.appendChild(dateInput);
      list.appendChild(dateWrap);

      if (!dateInput.dataset.mdpAttached && typeof MaterialDatePicker !== 'undefined' && typeof MaterialDatePicker.attach === 'function') {
        setTimeout(() => MaterialDatePicker.attach(dateInput), 0);
      }
    }

    if (allOptions.length === 0 && !catConfig.hasDatePicker) {
      list.appendChild(el('div', { class: 'jira-filter-values-empty', text: 'No results' }));
    } else {
      allOptions.forEach(opt => {
        const catSet = activeFilters[selectedCategory];
        const isChecked = catSet ? catSet.has(opt.value) : false;
        const isVisible = !query || opt.label.toLowerCase().includes(query);
        if (isVisible) visibleCount++;

        const row = el('button', {
          type: 'button',
          class: 'jira-filter-value-item' + (isVisible ? '' : ' hidden')
        });
        const checkbox = el('input', { type: 'checkbox', class: 'jira-filter-checkbox' });
        checkbox.checked = isChecked;
        checkbox.addEventListener('click', (e) => e.stopPropagation());

        const label = el('span', { text: opt.label });
        row.appendChild(checkbox);
        row.appendChild(label);

        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (catSet) {
            if (catSet.has(opt.value)) catSet.delete(opt.value);
            else catSet.add(opt.value);
          }
          updateFilterUI();
          if (onFilterChange) onFilterChange();
        });

        list.appendChild(row);
      });
    }

    const footer = filterDropdown.querySelector('.jira-filter-values-footer');
    if (footer) {
      footer.innerHTML = '';
      const selectedInCat = activeFilters[selectedCategory] ? activeFilters[selectedCategory].size : 0;
      const clearCatBtn = el('button', {
        type: 'button',
        class: 'jira-filter-clear-cat' + (selectedInCat > 0 ? '' : ' disabled'),
        text: 'Clear'
      });
      if (selectedInCat > 0) {
        clearCatBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (activeFilters[selectedCategory]) activeFilters[selectedCategory].clear();
          updateFilterUI();
          if (onFilterChange) onFilterChange();
        });
      }
      footer.appendChild(clearCatBtn);
      footer.appendChild(el('span', { class: 'jira-filter-footer-count', text: `${visibleCount} of ${allOptions.length}` }));
    }
  };

  const updateFilterUI = () => {
    const catList = filterDropdown.querySelector('.jira-filter-categories-list');
    if (catList) {
      const catKeys = Object.keys(categories);
      catKeys.forEach((cat, index) => {
        const catBtn = catList.children[index];
        if (catBtn) {
          catBtn.className = 'jira-filter-category' + (selectedCategory === cat ? ' active' : '');
          catBtn.textContent = categories[cat].label;
          const count = activeFilters[cat] ? activeFilters[cat].size : 0;
          if (count > 0) {
            catBtn.appendChild(el('span', { class: 'cat-count', text: String(count) }));
          }
        }
      });
    }

    const clearAllBtn = filterDropdown.querySelector('.jira-filter-clear-all');
    if (clearAllBtn) {
      const totalActive = getActiveFilterCount();
      clearAllBtn.className = 'jira-filter-clear-all' + (totalActive > 0 ? '' : ' disabled');
    }

    const count = getActiveFilterCount();
    filterBadge.textContent = String(count);
    filterBadge.classList.toggle('hidden', count === 0);
    clearFiltersBtn.classList.toggle('hidden', count === 0);

    renderFilterValues();
  };

  const renderFilterDropdown = () => {
    filterDropdown.innerHTML = '';
    const body = el('div', { class: 'jira-filter-body' });

    // Left Pane: Categories
    const leftPane = el('div', { class: 'jira-filter-categories' });
    const catList = el('div', { class: 'jira-filter-categories-list' });

    Object.keys(categories).forEach(cat => {
      const catBtn = el('button', {
        type: 'button',
        class: 'jira-filter-category' + (selectedCategory === cat ? ' active' : '')
      });
      catBtn.appendChild(document.createTextNode(categories[cat].label));
      const count = activeFilters[cat] ? activeFilters[cat].size : 0;
      if (count > 0) {
        catBtn.appendChild(el('span', { class: 'cat-count', text: String(count) }));
      }
      catBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedCategory = cat;
        renderFilterDropdown();
      });
      catList.appendChild(catBtn);
    });
    leftPane.appendChild(catList);

    const catFooter = el('div', { class: 'jira-filter-categories-footer' });
    const totalActive = getActiveFilterCount();
    const clearAllBtn = el('button', {
      type: 'button',
      class: 'jira-filter-clear-all' + (totalActive > 0 ? '' : ' disabled'),
      text: 'Clear all'
    });
    clearAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (getActiveFilterCount() === 0) return;
      Object.keys(activeFilters).forEach(cat => activeFilters[cat] && activeFilters[cat].clear());
      if (moduleName) App.clearSavedFilters(moduleName);
      updateFilterUI();
      if (onFilterChange) onFilterChange();
    });
    catFooter.appendChild(clearAllBtn);
    leftPane.appendChild(catFooter);

    // Right Pane: Values
    const rightPane = el('div', { class: 'jira-filter-values' });
    const valuesHeader = el('div', { class: 'jira-filter-values-header' });
    const searchIcon = el('span', {
      class: 'jira-filter-search-icon',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    });
    const searchInput = el('input', {
      type: 'text',
      class: 'jira-filter-search',
      placeholder: `Search ${(categories[selectedCategory] ? categories[selectedCategory].label : '').toLowerCase()}`
    });
    searchInput.addEventListener('input', () => renderFilterValues());
    valuesHeader.appendChild(searchIcon);
    valuesHeader.appendChild(searchInput);
    rightPane.appendChild(valuesHeader);

    const valuesList = el('div', { class: 'jira-filter-values-list' });
    rightPane.appendChild(valuesList);
    const valuesFooter = el('div', { class: 'jira-filter-values-footer' });
    rightPane.appendChild(valuesFooter);

    body.appendChild(leftPane);
    body.appendChild(rightPane);
    filterDropdown.appendChild(body);

    const globalFooter = el('div', { class: 'jira-filter-global-footer' });
    const shortcutHint = el('div', {
      class: 'jira-filter-shortcut-hint',
      html: 'Press <kbd>Shift</kbd> + <kbd>F</kbd> to open and close'
    });
    globalFooter.appendChild(shortcutHint);
    filterDropdown.appendChild(globalFooter);

    renderFilterValues();
  };

  filterTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = filterDropdown.classList.contains('hidden');
    if (isHidden) {
      filterDropdown.classList.remove('hidden');
      renderFilterDropdown();
      const searchInput = filterDropdown.querySelector('.jira-filter-search');
      if (searchInput) searchInput.focus();
    } else {
      filterDropdown.classList.add('hidden');
    }
  });

  filterWrap.appendChild(filterTrigger);
  filterWrap.appendChild(filterDropdown);

  const clearFiltersBtn = el('button', { type: 'button', class: 'jira-clear-filters hidden', text: 'Clear filters' });
  clearFiltersBtn.addEventListener('click', () => {
    Object.keys(activeFilters).forEach(cat => activeFilters[cat] && activeFilters[cat].clear());
    if (moduleName) App.clearSavedFilters(moduleName);
    updateFilterUI();
    if (onFilterChange) onFilterChange();
  });

  // Search input (beside filter)
  if (searchConfig) {
    const searchWrap = el('div', { class: 'jira-search-wrap' });
    const searchInput = el('input', {
      type: 'text',
      class: 'jira-search-input',
      placeholder: searchConfig.placeholder || 'Search...',
      autocomplete: 'off'
    });
    const searchIcon = el('span', {
      class: 'jira-search-icon',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    });
    const clearBtn = el('button', {
      type: 'button',
      class: 'jira-search-clear hidden',
      html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      title: 'Clear search'
    });

    searchInput.addEventListener('input', debounce(() => {
      const q = searchInput.value.trim().toLowerCase();
      clearBtn.classList.toggle('hidden', !q);
      if (searchConfig.onSearch) searchConfig.onSearch(q);
    }, 200));

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.classList.add('hidden');
      if (searchConfig.onSearch) searchConfig.onSearch('');
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        clearBtn.classList.add('hidden');
        if (searchConfig.onSearch) searchConfig.onSearch('');
      }
    });

    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(clearBtn);
    toolbar.appendChild(searchWrap);
  }

  toolbar.appendChild(filterWrap);
  toolbar.appendChild(clearFiltersBtn);

  // Grouping Dropdown
  if (groupByOptions && onGroupByChange) {
    let activeGroupKey = currentGroupBy || 'none';
    groupWrap = el('div', { class: 'jira-group-wrap' });
    groupWrap.classList.toggle('hidden', !!(viewMode && activeViewMode !== 'board'));
    const groupIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';
    const groupCaretSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const groupTrigger = el('button', { type: 'button', class: 'jira-group-trigger' });
    const groupOptionsAll = [
      { key: 'none', label: 'None' },
      ...groupByOptions.filter(opt => opt.key !== 'none')
    ];

    const renderGroupTrigger = () => {
      const selected = groupOptionsAll.find(opt => opt.key === activeGroupKey);
      const label = (activeGroupKey && activeGroupKey !== 'none' && selected)
        ? 'Group: ' + selected.label
        : 'Group';
      groupTrigger.classList.toggle('active', !!(activeGroupKey && activeGroupKey !== 'none'));
      groupTrigger.innerHTML = groupIconSvg + ' <span>' + escapeHtml(label) + '</span> ' + groupCaretSvg;
    };
    renderGroupTrigger();

    const groupDropdown = el('div', { class: 'jira-dropdown jira-group-dropdown hidden' });
    const renderGroupDropdown = () => {
      groupDropdown.innerHTML = '';
      groupOptionsAll.forEach(opt => {
        const active = activeGroupKey === opt.key;
        const btn = el('button', {
          type: 'button',
          class: 'jira-group-option' + (active ? ' active' : ''),
          html: escapeHtml(opt.label) + (active ? ' <span class="checkmark"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' : '')
        });
        btn.addEventListener('click', () => {
          groupDropdown.classList.add('hidden');
          activeGroupKey = opt.key;
          onGroupByChange(opt.key);
          renderGroupTrigger();
          renderGroupDropdown();
        });
        groupDropdown.appendChild(btn);
      });
    };
    renderGroupDropdown();
    groupTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      filterDropdown.classList.add('hidden');
      groupDropdown.classList.toggle('hidden');
    });
    groupWrap.appendChild(groupTrigger);
    groupWrap.appendChild(groupDropdown);
    toolbar.appendChild(groupWrap);
  }

  // Sorting Dropdown
  if (sortOptions && onSortChange) {
    let activeSortKey = currentSort || 'newest';
    const sortWrap = el('div', { class: 'jira-sort-wrap' });
    const sortIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18H3M21 14H3M18 10H3M21 6H3"/></svg>';
    const sortCaretSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const sortTrigger = el('button', { type: 'button', class: 'jira-group-trigger jira-sort-trigger' });

    const renderSortTrigger = () => {
      const selected = sortOptions.find(opt => opt.key === activeSortKey);
      const label = selected ? 'Sort: ' + selected.label : 'Sort';
      sortTrigger.classList.toggle('active', activeSortKey !== 'newest');
      sortTrigger.innerHTML = sortIconSvg + ' <span>' + escapeHtml(label) + '</span> ' + sortCaretSvg;
    };
    renderSortTrigger();

    const sortDropdown = el('div', { class: 'jira-dropdown jira-group-dropdown jira-sort-dropdown hidden' });
    const renderSortDropdown = () => {
      sortDropdown.innerHTML = '';
      const body = el('div', { class: 'jira-dropdown-body' });
      sortOptions.forEach(opt => {
        const active = activeSortKey === opt.key;
        const btn = el('button', {
          type: 'button',
          class: 'jira-group-option jira-sort-option' + (active ? ' active' : ''),
          html: escapeHtml(opt.label) + (active ? ' <span class="checkmark"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' : '')
        });
        btn.addEventListener('click', () => {
          sortDropdown.classList.add('hidden');
          activeSortKey = opt.key;
          onSortChange(opt.key);
          renderSortTrigger();
          renderSortDropdown();
        });
        body.appendChild(btn);
      });
      sortDropdown.appendChild(body);
    };
    renderSortDropdown();

    sortTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.jira-group-dropdown, .jira-filter-dropdown, .jira-sort-dropdown').forEach(d => {
        if (d !== sortDropdown) d.classList.add('hidden');
      });
      sortDropdown.classList.toggle('hidden');
    });

    sortWrap.appendChild(sortTrigger);
    sortWrap.appendChild(sortDropdown);
    toolbar.appendChild(sortWrap);
  }

  // Attach global Shift+F shortcut and outside-click listeners once.
  attachJiraGlobalShortcuts();

  updateFilterUI();
  container.appendChild(toolbar);
  return container;
}

/**
 * Attach the global Shift+F filter shortcut and outside-click dropdown closer once.
 * Called automatically by createJiraFilterToolbar() and can be called manually by
 * modules that build their own Jira-style toolbar (e.g. Operations).
 */
function attachJiraGlobalShortcuts() {
  if (!window._jiraGlobalShortcutListenerAttached) {
    window._jiraGlobalShortcutListenerAttached = true;
    document.addEventListener('keydown', (e) => {
      if (e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        const activeTag = document.activeElement ? document.activeElement.tagName : '';
        const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag) || document.activeElement?.isContentEditable;
        const isFilterSearch = document.activeElement?.classList?.contains('jira-filter-search');
        if (isInput && !isFilterSearch) return;

        const visibleFilterWrap = document.querySelector('.jira-filter-wrap');
        if (visibleFilterWrap) {
          e.preventDefault();
          const trigger = visibleFilterWrap.querySelector('.jira-filter-trigger');
          if (trigger) trigger.click();
        }
      }
    });
  }

  if (!window._jiraGlobalClickListenerAttached) {
    window._jiraGlobalClickListenerAttached = true;
    document.addEventListener('click', (e) => {
      if (!e.target || !e.target.isConnected) return;
      if (
        e.target.closest('.jira-group-wrap') ||
        e.target.closest('.jira-filter-wrap') ||
        e.target.closest('.jira-sort-wrap') ||
        e.target.closest('.mdp-overlay') ||
        e.target.closest('.mdp-dialog') ||
        e.target.closest('.mdp-wrapper') ||
        e.target.closest('.mdp-container')
      ) {
        return;
      }
      document.querySelectorAll('.jira-group-dropdown, .jira-filter-dropdown, .jira-sort-dropdown').forEach(d => d.classList.add('hidden'));
    });
  }
}

/**
 * Render a Jira-style grouped (swimlane) board view.
 * Mirrors the DOM produced by Workflow.refreshBoard() for grouped boards so
 * any module that uses createJiraFilterToolbar() can opt into the same
 * collapsible sticky swimlane layout without duplicating the markup.
 *
 * @param {Object} config
 * @param {HTMLElement} config.container
 * @param {Array} config.items
 * @param {Array} config.columns - same column objects passed to KanbanBoard.render()
 * @param {Function} [config.getColumnKey] - optional top-level column resolver
 * @param {Function} config.renderCard - (item, column) => HTMLElement
 * @param {Function} [config.cardMenuItems] - (item) => Array menu items
 * @param {HTMLElement} [config.toolbarContainer] - receives grouped-board-active class
 * @param {string} config.groupBy - active group key
 * @param {Array} config.groupOptions - { key, label, getName(item), specialLast?, getGroupMeta(name)? }
 * @param {string} [config.storageKey='erp_grouped_collapsed'] - sessionStorage key prefix
 */
function renderGroupedKanbanBoard(config = {}) {
  const {
    container,
    items = [],
    columns = [],
    getColumnKey,
    renderCard,
    cardMenuItems,
    toolbarContainer,
    groupBy,
    groupOptions = [],
    storageKey = 'erp_grouped_collapsed',
    drag = null
  } = config;

  if (!container || !columns.length) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  toolbarContainer?.classList.add('grouped-board-active');

  if (items.length === 0) {
    container.appendChild(renderEmptyStateV2({
      variant: 'zero-state',
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
      title: 'No items found',
      body: ''
    }));
    return;
  }

  const groupOpt = groupOptions.find(o => o.key === groupBy);
  if (!groupOpt || typeof groupOpt.getName !== 'function') return;

  const belongsToColumn = (item, column) => {
    if (typeof getColumnKey === 'function') return getColumnKey(item) === column.key;
    if (Array.isArray(column.statuses)) return column.statuses.includes(item.status);
    if (typeof column.filter === 'function') return column.filter(item);
    return item.status === (column.targetStatus || column.key);
  };

  const groupMap = new Map();
  items.forEach(item => {
    const name = groupOpt.getName(item);
    if (!groupMap.has(name)) groupMap.set(name, []);
    groupMap.get(name).push(item);
  });

  const specialLast = groupOpt.specialLast || '';
  const groupNames = Array.from(groupMap.keys()).sort((a, b) => {
    if (a === specialLast) return 1;
    if (b === specialLast) return -1;
    return a.localeCompare(b);
  });

  const fullStorageKey = `${storageKey}_${location.hash.replace(/\//g, '_') || 'default'}`;
  const getCollapsedSet = () => {
    try {
      const raw = JSON.parse(sessionStorage.getItem(fullStorageKey) || '[]');
      return new Set(Array.isArray(raw) ? raw : []);
    } catch (e) { return new Set(); }
  };
  const saveCollapsedSet = (set) => {
    try { sessionStorage.setItem(fullStorageKey, JSON.stringify([...set])); } catch (e) { /* ignore */ }
  };

  const hashString = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return h;
  };
  const avatarPalette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316'];
  const groupColor = (str) => avatarPalette[Math.abs(hashString(str)) % avatarPalette.length];
  const getInitials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');

  const groupedBoard = el('div', { class: 'board-grouped-rows' });

  groupNames.forEach(name => {
    const groupItems = groupMap.get(name);
    const sectionKey = `group-${groupBy}-${name}`;
    const collapsedSet = getCollapsedSet();
    const isCollapsed = collapsedSet.has(sectionKey);

    const section = el('div', { class: 'board-group-section' + (isCollapsed ? ' collapsed' : '') });
    section.style.setProperty('--phase-count', String(columns.length));

    const titleRow = el('div', { class: 'board-group-title-row' });
    const titleCell = el('div', { class: 'board-group-title' });
    const chevronBtn = el('button', {
      type: 'button',
      class: 'board-group-collapse',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
    });
    const avatar = el('div', { class: 'board-group-avatar' });

    let displayName = name;
    if (typeof groupOpt.getGroupMeta === 'function') {
      const meta = groupOpt.getGroupMeta(name) || {};
      displayName = meta.displayName || name;
      if (meta.avatarUrl) {
        avatar.style.backgroundImage = "url('" + meta.avatarUrl + "')";
        avatar.style.backgroundSize = 'cover';
      } else {
        avatar.textContent = getInitials(displayName);
      }
      if (meta.color) avatar.style.backgroundColor = meta.color;
    } else {
      avatar.textContent = getInitials(displayName);
    }
    if (!avatar.style.backgroundColor) {
      avatar.style.backgroundColor = groupColor(displayName);
      avatar.style.color = '#fff';
    }

    const nameWrap = el('div', { class: 'board-group-name-wrap' });
    const nameLine = el('div', { class: 'board-group-name' });
    nameLine.appendChild(document.createTextNode(displayName + ' '));
    nameLine.appendChild(el('span', {
      class: 'board-group-count',
      text: '(' + groupItems.length + ' item' + (groupItems.length === 1 ? '' : 's') + ')'
    }));
    nameWrap.appendChild(nameLine);

    titleCell.appendChild(chevronBtn);
    titleCell.appendChild(avatar);
    titleCell.appendChild(nameWrap);
    titleRow.appendChild(titleCell);

    const toggleSection = () => {
      const set = getCollapsedSet();
      const currently = set.has(sectionKey);
      if (currently) set.delete(sectionKey);
      else set.add(sectionKey);
      saveCollapsedSet(set);
      section.classList.toggle('collapsed', !currently);
    };
    titleCell.addEventListener('click', toggleSection);
    chevronBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSection(); });

    const phaseRow = el('div', { class: 'board-group-phase-row' });
    phaseRow.style.setProperty('--phase-count', String(columns.length));
    columns.forEach(column => {
      const count = groupItems.filter(item => belongsToColumn(item, column)).length;
      const cell = el('div', { class: 'board-group-phase-header' });
      cell.style.setProperty('--phase-color', column.color);
      cell.appendChild(el('div', { class: 'phase-header-top' }));
      const headerBody = el('div', { class: 'phase-header-body' });
      headerBody.appendChild(el('span', { class: 'board-column-dot', html: buildColumnStatusIcon({ key: column.key, color: column.color, icon: column.icon || 'phase' }) }));
      headerBody.appendChild(el('span', { class: 'phase-header-label', text: column.label.toUpperCase() }));
      headerBody.appendChild(el('span', { class: 'phase-header-count', text: count + ' OF ' + groupItems.length }));
      cell.appendChild(headerBody);
      phaseRow.appendChild(cell);
    });

    const stickyWrap = el('div', { class: 'board-group-sticky-wrap' });
    stickyWrap.appendChild(titleRow);
    stickyWrap.appendChild(phaseRow);
    section.appendChild(stickyWrap);

    const body = el('div', { class: 'board-group-body' });
    body.style.setProperty('--phase-count', String(columns.length));
    columns.forEach(column => {
      const col = el('div', { class: 'board-group-column', 'data-target-status': column.targetStatus || column.key });
      col.style.setProperty('--column-phase-color', column.color);
      const colItems = groupItems.filter(item => belongsToColumn(item, column));
      if (colItems.length === 0) {
        col.appendChild(renderEmptyStateV2({ variant: 'compact', title: 'No ' + column.label.toLowerCase(), body: '' }));
      } else {
        colItems.forEach(item => {
          const card = renderCard(item, column);
          if (card && item?.id) card.dataset.itemId = item.id;
          const items = cardMenuItems ? cardMenuItems(item) : [];
          if (items.length > 0 && typeof KanbanBoard !== 'undefined') {
            KanbanBoard.attachCardMenu(card, items);
          }
          col.appendChild(card);
        });
      }
      body.appendChild(col);
    });
    section.appendChild(body);
    groupedBoard.appendChild(section);
  });

  container.appendChild(groupedBoard);

  // Attach the same drag-and-drop mechanics available on ungrouped KanbanBoard.render()
  // so grouped swimlanes can reorder within a column and move across columns/groups.
  if (drag && typeof KanbanBoard !== 'undefined' && typeof KanbanBoard.attachDrag === 'function') {
    KanbanBoard.attachDrag({
      root: groupedBoard,
      items,
      drag,
      columnSelector: '.board-group-column',
      cardContainerSelector: '.board-group-column',
      cardSelector: '.board-card-v2.compact'
    });
  }
}

/**
 * Shared archive page layout (pill-filtered categories with hover actions).
 * Modeled on the Admin Pending Approvals page.
 */
const ArchivePage = {
  icons: {
    accomplished: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    cancelled: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    rejected: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    client: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    status: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20"/></svg>',
    date: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    amount: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    view: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    archive: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    unarchive: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><path d="M12 12v6"/><path d="M8 14l4-4 4 4"/></svg>',
    restore: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    delete: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
  },

  /**
   * Render a full archive page.
   * @param {string} opts.module - unique module key (e.g. 'workflow', 'billing').
   * @param {Array} opts.categories - category definitions with { key, label, items, renderItem }.
   * @param {string} [opts.emptyText] - message shown when archive is empty.
   * @returns {HTMLElement}
   */
  render({ module, categoryLabels = {}, categories, emptyText = 'Archive is empty.', bulkActions, pagination }) {
    const wrapper = el('div');
    const storageKey = 'erp_archive_category_' + (typeof module === 'string' ? module : (module?.constructor?.name || 'module'));
    let selected = sessionStorage.getItem(storageKey) || 'all';

    const categoryList = Array.isArray(categories)
      ? categories
      : Object.entries(categories || {}).map(([key, items]) => ({
          key,
          label: categoryLabels[key] || key,
          items: items || [],
          renderItem: (item, idx, selectable) => ArchivePage.renderSimpleItem(item, idx, selectable)
        }));

    const total = categoryList.reduce((sum, cat) => sum + (cat.items || []).length, 0);
    if (total === 0) {
      wrapper.appendChild(renderEmptyState(emptyText, null, { variant: 'zero-state' }));
      return wrapper;
    }

    const hasBulkActions = Array.isArray(bulkActions) || typeof bulkActions === 'function';
    const selectedIds = new Set();
    const rowCheckboxes = [];
    let bulkBar = null, bulkCount = null, bulkActionsContainer = null, bulkClose = null;

    if (hasBulkActions) {
      bulkBar = el('div', { class: 'jira-backlog-bulk-bar archive-page-bulk-bar hidden' });
      bulkCount = el('span', { class: 'jira-backlog-bulk-count', text: '0 selected' });
      bulkBar.appendChild(bulkCount);
      bulkBar.appendChild(el('span', { class: 'jira-backlog-bulk-divider', text: '|' }));
      bulkActionsContainer = el('div', { class: 'jira-backlog-bulk-actions' });
      bulkBar.appendChild(bulkActionsContainer);
      bulkBar.appendChild(el('span', { class: 'jira-backlog-bulk-divider', text: '|' }));
      bulkClose = el('button', { class: 'jira-backlog-bulk-close', html: '&times;', title: 'Clear selection' });
      bulkBar.appendChild(bulkClose);
      wrapper.appendChild(bulkBar);
    }

    const updateBulkBar = () => {
      if (!bulkBar) return;
      const ids = Array.from(selectedIds);
      if (ids.length === 0) {
        bulkBar.classList.add('hidden');
        return;
      }
      bulkCount.textContent = `${ids.length} selected`;
      bulkActionsContainer.innerHTML = '';
      const actionsList = typeof bulkActions === 'function' ? bulkActions(ids) : bulkActions;
      (actionsList || []).forEach(act => {
        const btn = el('button', {
          class: act.className || 'btn btn-secondary btn-sm',
          text: act.text
        });
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          act.onClick(ids);
        });
        bulkActionsContainer.appendChild(btn);
      });
      bulkBar.classList.remove('hidden');
    };

    if (bulkClose) {
      bulkClose.addEventListener('click', () => {
        selectedIds.clear();
        rowCheckboxes.forEach(cb => { cb.checked = false; });
        updateBulkBar();
      });
    }

    const selectCategory = (key) => {
      sessionStorage.setItem(storageKey, key);
      selected = key;
      App.handleRoute();
    };

    wrapper.appendChild(this.renderPills(categoryList, total, selected, selectCategory));

    categoryList.forEach(cat => {
      const items = cat.items || [];
      if (items.length === 0) return;
      if (selected !== 'all' && selected !== cat.key) return;
      wrapper.appendChild(this.renderCategoryCard(cat, hasBulkActions, selectedIds, rowCheckboxes, updateBulkBar));
    });

    if (pagination) {
      wrapper.appendChild(this.renderPagination(pagination));
    }

    return wrapper;
  },

  renderPagination({ page = 1, limit = 20, total = 0, onPage }) {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const hasPrev = page > 1;
    const hasNext = page < totalPages;

    const wrap = el('div', { class: 'archive-pagination', style: 'display:flex;align-items:center;gap:var(--spacing-md);margin-top:var(--spacing-lg);' });
    const info = el('span', { class: 'archive-pagination-info', text: `Page ${page} of ${totalPages} (${total} total)`, style: 'min-width:120px;text-align:center;color:var(--color-text-muted);font-size:0.875rem;' });

    const prevBtn = el('button', {
      class: 'btn btn-secondary btn-sm' + (hasPrev ? '' : ' disabled'),
      type: 'button',
      text: 'Previous',
      disabled: !hasPrev
    });
    prevBtn.addEventListener('click', () => {
      if (hasPrev && typeof onPage === 'function') onPage(page - 1);
    });

    const nextBtn = el('button', {
      class: 'btn btn-secondary btn-sm' + (hasNext ? '' : ' disabled'),
      type: 'button',
      text: 'Next',
      disabled: !hasNext
    });
    nextBtn.addEventListener('click', () => {
      if (hasNext && typeof onPage === 'function') onPage(page + 1);
    });

    wrap.appendChild(prevBtn);
    wrap.appendChild(info);
    wrap.appendChild(nextBtn);
    return wrap;
  },

  renderSimpleItem(item, idx, selectable) {
    const iconKey = item.icon || (item.category === 'cancelled' ? 'cancelled' : item.category === 'rejected' ? 'rejected' : 'accomplished');
    const metaNodes = (item.meta || []).map(m => ArchivePage.metaNode(m.icon || '', m.text, m.className || ''));
    const actionButtons = (item.actions || []).map(a => ({
      label: a.label,
      iconHtml: a.icon || a.iconHtml || '',
      className: a.className || '',
      onClick: a.onClick
    }));
    return ArchivePage.renderItemRow({
      id: item.id,
      iconHtml: item.iconHtml || ArchivePage.icons[iconKey],
      keyText: item.keyText,
      title: item.title,
      description: item.description,
      metaNodes,
      actions: actionButtons,
      selectable
    });
  },

  renderPills(categories, total, selected, onSelect) {
    const wrap = el('div', { class: 'approval-filter-pills' });

    const add = (key, label, count, isActive, disabled) => {
      const btn = el('button', {
        class: 'approval-filter-pill' + (isActive ? ' active' : '') + (disabled ? ' disabled' : ''),
        title: label,
        disabled: disabled ? true : false
      });
      btn.appendChild(document.createTextNode(label));
      if (count !== undefined) {
        btn.appendChild(document.createTextNode(' '));
        btn.appendChild(el('span', { class: 'approval-filter-pill-count', text: String(count) }));
      }
      if (!disabled) {
        btn.addEventListener('click', () => onSelect(key));
      }
      wrap.appendChild(btn);
    };

    add('all', 'All', total, selected === 'all', false);
    categories.forEach(cat => {
      const count = (cat.items || []).length;
      if (count === 0) return;
      add(cat.key, cat.label, count, selected === cat.key, false);
    });

    return wrap;
  },

  renderCategoryCard(category, hasBulkActions, selectedIds, rowCheckboxes, updateBulkBar) {
    const card = el('div', { class: 'approval-category-card' });

    const header = el('div', { class: 'approval-category-header' });
    const title = el('div', { class: 'approval-category-title' });
    title.appendChild(el('span', { text: category.label }));
    const countText = category.items.length + (category.items.length === 1 ? ' item' : ' items');
    title.appendChild(el('span', { class: 'count', text: countText }));
    header.appendChild(title);

    let selectAllCheckbox = null;
    if (hasBulkActions) {
      selectAllCheckbox = el('input', {
        type: 'checkbox',
        class: 'archive-category-select-all',
        title: 'Select all'
      });
      header.appendChild(selectAllCheckbox);
    }

    card.appendChild(header);

    const list = el('div', { class: 'approval-items-list' });
    const categoryCheckboxes = [];

    category.items.forEach((item, idx) => {
      const row = category.renderItem(item, idx, hasBulkActions);
      if (hasBulkActions && row.dataset && row.dataset.id) {
        const chk = row.querySelector('.archive-row-checkbox');
        if (chk) {
          categoryCheckboxes.push(chk);
          rowCheckboxes.push(chk);
          chk.addEventListener('change', () => {
            if (chk.checked) selectedIds.add(chk.dataset.id);
            else selectedIds.delete(chk.dataset.id);
            updateBulkBar();
          });
        }
      }
      list.appendChild(row);
    });

    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', () => {
        categoryCheckboxes.forEach(chk => {
          chk.checked = selectAllCheckbox.checked;
          if (chk.checked) selectedIds.add(chk.dataset.id);
          else selectedIds.delete(chk.dataset.id);
        });
        updateBulkBar();
      });
    }

    card.appendChild(list);

    return card;
  },

  /**
   * Build a single archive row with hover-reveal actions.
   * @param {Object} opts
   * @param {string} opts.iconHtml - SVG string for the status icon.
   * @param {string} [opts.keyText] - small key label.
   * @param {string} opts.title - primary row title.
   * @param {string} [opts.description] - secondary text.
   * @param {Array<HTMLElement>} [opts.metaNodes] - nodes appended to the meta row.
   * @param {Array<{label, onClick, className, iconHtml}>} [opts.actions] - action buttons.
   * @returns {HTMLElement}
   */
  renderItemRow({ id, iconHtml, keyText, title, description, metaNodes = [], actions = [], selectable }) {
    const row = el('div', { class: 'approval-item' });
    if (id) row.dataset.id = id;

    if (selectable && id) {
      const checkbox = el('input', {
        type: 'checkbox',
        class: 'archive-row-checkbox',
        'data-id': id,
        title: 'Select'
      });
      const checkboxWrap = el('div', { class: 'archive-row-checkbox-wrap' });
      checkboxWrap.appendChild(checkbox);
      row.appendChild(checkboxWrap);
    }

    const icon = el('div', { class: 'approval-item-icon' });
    icon.innerHTML = iconHtml || '';
    row.appendChild(icon);

    const body = el('div', { class: 'approval-item-body' });
    if (keyText) body.appendChild(el('div', { class: 'approval-item-key', text: keyText }));
    body.appendChild(el('div', { class: 'approval-item-title', text: title }));
    if (description) body.appendChild(el('div', { class: 'approval-item-desc', text: description }));

    const meta = el('div', { class: 'approval-item-meta' });
    metaNodes.forEach(n => meta.appendChild(n));
    if (meta.children.length) body.appendChild(meta);

    row.appendChild(body);

    if (actions.length) {
      const act = el('div', { class: 'approval-item-actions' });
      actions.forEach(a => {
        const btn = el('button', {
          class: 'btn btn-sm ' + (a.className || 'btn-secondary'),
          title: a.label,
          type: 'button'
        });
        btn.innerHTML = (a.iconHtml || '') + ' ' + escapeHtml(a.label);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          a.onClick();
        });
        act.appendChild(btn);
      });
      row.appendChild(act);
    }

    return row;
  },

  metaNode(html, text, className = '') {
    const span = el('span', { class: className });
    span.innerHTML = (html || '') + '<span>' + escapeHtml(text) + '</span>';
    return span;
  },

  dateNode(date) {
    const node = this.metaNode(BoardCardIcons.calendar, formatDate(date), 'approval-item-date');
    return node;
  },

  amountNode(amount) {
    return el('span', { class: 'approval-item-amount', text: formatPHP(amount) });
  },

  badgeNode(text, opts = {}) {
    return el('span', { class: 'submitter-badge ' + (opts.className || ''), text });
  }
};

const JiraBacklogList = {
  render(options = {}) {
    const {
      title,
      subtitle,
      items = [],
      emptyText = 'No templates found',
      headerActions = [],
      rowActions = () => [],
      rowIdPrefix = 'TPL',
      bulkActions,
      countLabel = 'template',
      columns,
      selectable = true
    } = options;

    const hasColumns = Array.isArray(columns) && columns.length > 0;
    const showCheckboxes = selectable !== false;
    const hasRowActions = items.some(item => {
      const acts = rowActions(item);
      return Array.isArray(acts) && acts.length > 0;
    });

    const container = el('div', { class: 'jira-backlog-container' + (hasColumns ? ' jira-backlog-container--columns' : '') });

    // Header
    const header = el('div', { class: 'jira-backlog-header' });

    // Left side info (Select All checkbox replaces chevron)
    const headerLeft = el('div', { class: 'jira-backlog-header-left', style: 'cursor: default;' });

    const selectAllCheckbox = showCheckboxes
      ? el('input', {
          type: 'checkbox',
          class: 'jira-backlog-header-checkbox',
          style: 'margin-right: 8px; cursor: pointer; accent-color: var(--color-primary); width: 14px; height: 14px;'
        })
      : null;
    if (selectAllCheckbox) headerLeft.appendChild(selectAllCheckbox);

    const titleText = el('div', { class: 'jira-backlog-title-text' });
    titleText.appendChild(el('span', { class: 'jira-backlog-title', text: title }));
    if (subtitle) {
      titleText.appendChild(el('span', { class: 'jira-backlog-subtitle', text: subtitle }));
    }
    headerLeft.appendChild(titleText);

    const countText = `${items.length} ${items.length === 1 ? countLabel : countLabel + 's'}`;
    const countBadge = el('span', { class: 'jira-backlog-count-badge', text: countText });
    headerLeft.appendChild(countBadge);
    header.appendChild(headerLeft);

    // Right side actions
    const headerRight = el('div', { class: 'jira-backlog-header-right' });
    headerActions.forEach(act => {
      const btn = el('button', {
        class: act.className || 'btn btn-secondary btn-sm',
        text: act.text
      });
      if (act.onClick) btn.addEventListener('click', act.onClick);
      headerRight.appendChild(btn);
    });
    header.appendChild(headerRight);

    container.appendChild(header);

    // Optional inline toolbar (filters, etc.) placed between header and list
    if (options.toolbar) {
      const toolbarWrap = el('div', { class: 'jira-backlog-toolbar' });
      toolbarWrap.appendChild(options.toolbar);
      container.appendChild(toolbarWrap);
    }

    // Optional column header (table-like alignment).
    // The lead spacers line up with the checkbox/icon/key/title area so the
    // first data column header sits directly above the first row data column.
    if (hasColumns) {
      const colHeader = el('div', { class: 'jira-backlog-columns-header' });
      // Fixed lead widths so the header and body columns line up exactly.
      const titleColWidth = options.titleColumnWidth || '1fr';
      const actionsCol = hasRowActions ? 'minmax(120px, max-content)' : '';
      const leadCols = `28px 24px 75px ${titleColWidth}`;
      const metaCols = columns.map(c => c.width || '1fr').join(' ');
      colHeader.style.gridTemplateColumns = `${leadCols} ${metaCols}${actionsCol ? ' ' + actionsCol : ''}`;

      // Lead-column placeholders: checkbox, icon, key, title.
      colHeader.appendChild(el('div', { class: 'jira-backlog-col-header jira-backlog-col-header--spacer' }));
      colHeader.appendChild(el('div', { class: 'jira-backlog-col-header jira-backlog-col-header--spacer' }));
      colHeader.appendChild(el('div', { class: 'jira-backlog-col-header jira-backlog-col-header--spacer' }));
      colHeader.appendChild(el('div', { class: 'jira-backlog-col-header jira-backlog-col-header--spacer' }));

      columns.forEach(col => {
        const alignClass = col.align ? ' jira-backlog-col-header--' + col.align : '';
        const h = el('div', { class: 'jira-backlog-col-header' + alignClass, text: col.label || '' });
        if (col.align) h.style.textAlign = col.align;
        colHeader.appendChild(h);
      });

      // Actions column header placed at the rightmost edge.
      if (hasRowActions) {
        colHeader.appendChild(el('div', { class: 'jira-backlog-col-header', text: 'Actions' }));
      }

      container.appendChild(colHeader);
    }

    // Body (Permanent, not collapsible)
    const body = el('div', { class: 'jira-backlog-body' });

    if (items.length === 0) {
      body.appendChild(renderEmptyState(emptyText, null, { variant: 'compact' }));
      container.appendChild(body);
      return container;
    }

    // Floating Bulk Action Bar (Jira backlog style)
    let bulkBar = null, countInfo = null, actionsContainer = null, closeBtn = null;
    if (showCheckboxes) {
      bulkBar = el('div', { class: 'jira-backlog-bulk-bar hidden' });
      
      countInfo = el('span', { class: 'jira-backlog-bulk-count', text: '0 selected' });
      bulkBar.appendChild(countInfo);
      
      const divider1 = el('span', { class: 'jira-backlog-bulk-divider', text: '|' });
      bulkBar.appendChild(divider1);
      
      actionsContainer = el('div', { class: 'jira-backlog-bulk-actions' });
      bulkBar.appendChild(actionsContainer);
      
      const divider2 = el('span', { class: 'jira-backlog-bulk-divider', text: '|' });
      bulkBar.appendChild(divider2);
      
      closeBtn = el('button', { class: 'jira-backlog-bulk-close', html: '&times;', title: 'Clear selection' });
      bulkBar.appendChild(closeBtn);
      container.appendChild(bulkBar);
    }

    const list = el('div', { class: 'jira-backlog-list' });

    const rows = [];
    const checkBoxes = [];

    // Bulk actions must be supplied by the caller. No default destructive action
    // is provided, preventing accidental deletes tied to legacy local DB state.
    const currentBulkActions = bulkActions || (() => []);

    const updateSelection = () => {
      const selectedIds = [];
      checkBoxes.forEach((chk, idx) => {
        if (chk.checked) {
          selectedIds.push(chk.dataset.id);
          rows[idx].classList.add('selected');
        } else {
          rows[idx].classList.remove('selected');
        }
      });

      if (bulkBar) {
        const actionsList = typeof currentBulkActions === 'function' ? currentBulkActions(selectedIds) : currentBulkActions;
        const finalActions = actionsList || [];
        if (selectedIds.length > 0 && finalActions.length > 0) {
          countInfo.textContent = `${selectedIds.length} selected`;
          
          actionsContainer.innerHTML = '';
          finalActions.forEach(act => {
            const btn = el('button', {
              class: act.className || 'btn btn-secondary btn-sm',
              text: act.text
            });
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              act.onClick(selectedIds);
            });
            actionsContainer.appendChild(btn);
          });
          
          bulkBar.classList.remove('hidden');
        } else {
          bulkBar.classList.add('hidden');
        }
      }

      if (selectAllCheckbox) {
        const allChecked = checkBoxes.length > 0 && checkBoxes.every(c => c.checked);
        const someChecked = checkBoxes.some(c => c.checked);
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;
      }
    };

    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', () => {
        checkBoxes.forEach(c => {
          c.checked = selectAllCheckbox.checked;
        });
        updateSelection();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        checkBoxes.forEach(c => {
          c.checked = false;
        });
        updateSelection();
      });
    }

    items.forEach((item, index) => {
      const rowClasses = ['jira-backlog-row'];
      if (hasColumns) rowClasses.push('jira-backlog-row--columns');
      if (hasColumns && options.titleColumnWidth) rowClasses.push('jira-backlog-row--fixed-title');
      const row = el('div', { class: rowClasses.join(' '), 'data-item-id': item.id });
      rows.push(row);

      // Checkbox container (shows on hover, stays visible when checked)
      if (showCheckboxes) {
        const checkboxWrap = el('div', { class: 'jira-backlog-row-checkbox-wrap' });
        const chk = el('input', {
          type: 'checkbox',
          class: 'jira-backlog-row-checkbox',
          'data-id': item.id
        });
        checkBoxes.push(chk);

        chk.addEventListener('change', () => {
          updateSelection();
        });
        checkboxWrap.addEventListener('click', (e) => {
          if (e.target !== chk) {
            e.stopPropagation();
            chk.checked = !chk.checked;
            chk.dispatchEvent(new Event('change'));
          }
        });
        checkboxWrap.appendChild(chk);
        row.appendChild(checkboxWrap);
      } else {
        // Keep alignment by reserving the checkbox lead column when hidden.
        const checkboxSpacer = el('div', { class: 'jira-backlog-row-checkbox-wrap jira-backlog-row-checkbox-wrap--spacer' });
        row.appendChild(checkboxSpacer);
      }

      // Icon (Jira backlog icon)
      const iconWrap = el('div', { class: 'jira-backlog-row-icon', html: item.iconHtml || `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` });
      row.appendChild(iconWrap);

      // Unique Key/ID
      const keyIndex = String(index + 1).padStart(2, '0');
      const keyVal = item.keyText || `${rowIdPrefix}-${keyIndex}`;
      const keyNode = el('div', { class: 'jira-backlog-row-key', text: keyVal });
      row.appendChild(keyNode);

      // Primary Title
      const titleNode = el('div', { class: 'jira-backlog-row-title', text: item.name });
      row.appendChild(titleNode);

      // Column-mode grid sizing (lead columns + metadata columns)
      if (hasColumns) {
        const titleColWidth = options.titleColumnWidth || '1fr';
        const actionsCol = hasRowActions ? 'minmax(120px, max-content)' : '';
        const leadCols = `28px 24px 75px ${titleColWidth}`;
        const metaCols = columns.map(c => c.width || '1fr').join(' ');
        row.style.gridTemplateColumns = `${leadCols} ${metaCols}${actionsCol ? ' ' + actionsCol : ''}`;
      }

      // Metadata / Tags
      const tagsNode = el('div', { class: 'jira-backlog-row-tags' + (hasColumns ? ' jira-backlog-row-tags--columns' : '') });
      if (hasColumns) {
        tagsNode.style.gridTemplateColumns = columns.map(c => c.width || '1fr').join(' ');
        tagsNode.style.gridColumn = `5 / span ${columns.length}`;
      }
      const tagList = item.tags || [];
      tagList.forEach((tag, tagIdx) => {
        const col = hasColumns ? columns[tagIdx] : null;
        const alignCls = col?.align ? ' jira-backlog-col-cell--' + col.align : '';
        const typeCls = tag.type ? ` jira-backlog-tag-${tag.type}` : '';
        let valCls = '';
        if (tag.type === 'schedule' && tag.value) {
          valCls = ` jira-backlog-tag-schedule-${tag.value.toLowerCase()}`;
        } else if (tag.type === 'fund' && tag.value) {
          valCls = ` jira-backlog-tag-fund-${tag.value.toLowerCase().replace(/\s+/g, '')}`;
        }

        const tNode = el('div', { class: 'jira-backlog-tag' + typeCls + valCls + (tag.className ? ' ' + tag.className : '') + alignCls });

        let iconHtml = '';
        if (tag.type === 'client') {
          iconHtml = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px; vertical-align: middle;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
        } else if (tag.type === 'schedule') {
          iconHtml = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px; vertical-align: middle;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        } else if (tag.type === 'category') {
          iconHtml = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px; vertical-align: middle;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
        } else if (tag.type === 'fund') {
          iconHtml = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px; vertical-align: middle;"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>';
        } else if (tag.type === 'amount') {
          iconHtml = '<span style="font-weight:700; margin-right:2px; font-size:0.75rem;">₱</span>';
        }

        let textVal = tag.text;
        if (tag.type === 'amount' && textVal.startsWith('₱')) {
          textVal = textVal.substring(1).trim();
        }

        if (tag.isHtml) {
          tNode.innerHTML = textVal;
        } else if (iconHtml) {
          tNode.innerHTML = iconHtml + '<span>' + escapeHtml(textVal) + '</span>';
        } else {
          tNode.textContent = textVal;
        }

        if (tag.style) tNode.setAttribute('style', tag.style);
        tagsNode.appendChild(tNode);
      });
      if (hasColumns) {
        for (let i = tagList.length; i < columns.length; i++) {
          tagsNode.appendChild(el('div', { class: 'jira-backlog-tag-placeholder' }));
        }
      }

      row.appendChild(tagsNode);

      // Actions column pinned to the rightmost edge of the row.
      if (hasColumns && hasRowActions) {
        const actionsNode = el('div', { class: 'jira-backlog-row-actions' });
        actionsNode.style.gridColumn = `-2 / -1`;
        const rowActionsList = rowActions(item);
        if (Array.isArray(rowActionsList) && rowActionsList.length > 0) {
          rowActionsList.forEach(act => {
            const btn = el('button', {
              class: act.className || 'btn btn-secondary btn-xs',
              html: act.html || act.text
            });
            if (act.title) btn.setAttribute('title', act.title);
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              act.onClick(item);
            });
            actionsNode.appendChild(btn);
          });
        }
        row.appendChild(actionsNode);
      }

      // Optional secondary line (for dense pages like Active Clients)
      if (item.secondary) {
        const secondaryNode = el('div', { class: 'jira-backlog-row-secondary', text: item.secondary });
        if (hasColumns) secondaryNode.style.gridColumn = '1 / -1';
        row.appendChild(secondaryNode);
      }

      // Actions on the far right (only if NOT in columns mode)
      if (!hasColumns) {
        const rowActionsList = rowActions(item);
        if (rowActionsList && rowActionsList.length > 0) {
          const actionsNode = el('div', { class: 'jira-backlog-row-actions' });
          rowActionsList.forEach(act => {
            const btn = el('button', {
              class: act.className || 'btn btn-secondary btn-xs',
              html: act.html || act.text
            });
            if (act.title) btn.setAttribute('title', act.title);
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              act.onClick(item);
            });
            actionsNode.appendChild(btn);
          });
          row.appendChild(actionsNode);
        }
      }

      list.appendChild(row);
    });

    body.appendChild(list);
    container.appendChild(body);
    return container;
  }
};

function getChronologicalSequenceMap(table) {
  const items = DB.getAll(table) || [];
  items.sort((a, b) => {
    const ta = new Date(a.createdAt || a.sentAt || a.submittedAt || a.requestedAt || a.issueDate || a.timestamp || 0).getTime();
    const tb = new Date(b.createdAt || b.sentAt || b.submittedAt || b.requestedAt || b.issueDate || b.timestamp || 0).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  const map = new Map();
  items.forEach((item, index) => {
    map.set(item.id, index + 1);
  });
  return map;
}


