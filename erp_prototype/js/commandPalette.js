/**
 * Global Command Palette (Cmd+K / Ctrl+K)
 * Universal search and navigation accelerator for ATA & LTA ERP.
 */

const CommandPalette = {
  isOpen: false,
  selectedIndex: 0,
  currentResults: [],
  overlayEl: null,
  inputEl: null,
  resultsEl: null,

  init() {
    this._createDOM();
    this._attachKeyListeners();
    this._injectNavTrigger();
  },

  _createDOM() {
    if (document.getElementById('command-palette-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'command-palette-overlay';
    overlay.className = 'command-palette-overlay hidden';

    overlay.innerHTML = `
      <div class="command-palette-modal" role="dialog" aria-modal="true" aria-label="Command Palette">
        <div class="command-palette-header">
          <svg class="command-palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input 
            type="text" 
            id="command-palette-input" 
            class="command-palette-input" 
            placeholder="Type a command or search Work Requests, Clients, Invoices, Tasks..." 
            autocomplete="off"
            spellcheck="false"
          />
          <kbd class="command-palette-esc-hint">ESC</kbd>
        </div>
        <div id="command-palette-results" class="command-palette-results"></div>
        <div class="command-palette-footer">
          <span class="cmd-shortcut-tip"><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span class="cmd-shortcut-tip"><kbd>↵</kbd> Select</span>
          <span class="cmd-shortcut-tip"><kbd>ESC</kbd> Close</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    this.overlayEl = overlay;
    this.inputEl = overlay.querySelector('#command-palette-input');
    this.resultsEl = overlay.querySelector('#command-palette-results');

    // Dismiss on background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Real-time search
    this.inputEl.addEventListener('input', () => {
      this.selectedIndex = 0;
      this._performSearch(this.inputEl.value.trim());
    });

    // Key navigation inside input
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._moveSelection(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this._executeSelected();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  },

  _attachKeyListeners() {
    window.addEventListener('keydown', (e) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    });
  },

  _injectNavTrigger() {
    const container = document.querySelector('.header-actions') || document.querySelector('.app-header');
    if (!container || document.getElementById('cmd-palette-nav-trigger')) return;

    const triggerBtn = document.createElement('button');
    triggerBtn.id = 'cmd-palette-nav-trigger';
    triggerBtn.className = 'btn btn-secondary btn-sm cmd-palette-nav-btn';
    triggerBtn.setAttribute('title', 'Global Search & Command Palette (Cmd+K / Ctrl+K)');
    triggerBtn.setAttribute('aria-label', 'Open search palette');
    triggerBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <span class="cmd-palette-btn-text">Search...</span>
      <kbd class="cmd-palette-btn-kbd">⌘K</kbd>
    `;

    triggerBtn.addEventListener('click', () => this.open());
    container.insertBefore(triggerBtn, container.firstChild);
  },

  open() {
    if (!this.overlayEl) this._createDOM();
    this.overlayEl.classList.remove('hidden');
    this.isOpen = true;
    this.inputEl.value = '';
    this.selectedIndex = 0;
    this._performSearch('');
    setTimeout(() => this.inputEl.focus(), 50);
  },

  close() {
    if (!this.overlayEl) return;
    this.overlayEl.classList.add('hidden');
    this.isOpen = false;
  },

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  },

  _getDefaultCommands() {
    const commands = [
      {
        category: 'Navigation',
        icon: '📊',
        title: 'Go to Dashboard',
        subtitle: 'Overview, analytics & daily reminders',
        action: () => { location.hash = '#dashboard'; }
      },
      {
        category: 'Navigation',
        icon: '💼',
        title: 'Go to Operations / Work Requests',
        subtitle: 'Kanban boards, task lifecycles & workflows',
        action: () => { location.hash = '#operations'; }
      },
      {
        category: 'Navigation',
        icon: '👥',
        title: 'Go to Client List',
        subtitle: 'Manage client accounts and retainers',
        action: () => { location.hash = '#clients'; }
      },
      {
        category: 'Navigation',
        icon: '💳',
        title: 'Go to Billing',
        subtitle: 'Invoices, payments & revenue',
        action: () => { location.hash = '#billing'; }
      },
      {
        category: 'Navigation',
        icon: '💸',
        title: 'Go to Disbursements',
        subtitle: 'Vouchers, expenses & fund releases',
        action: () => { location.hash = '#disbursement'; }
      },
      {
        category: 'Navigation',
        icon: '📁',
        title: 'Go to Transmittals & Documents',
        subtitle: 'Document receipts & client deliveries',
        action: () => { location.hash = '#transmittal'; }
      }
    ];

    if (window.Auth?.user?.role === 'Admin') {
      commands.push({
        category: 'Navigation',
        icon: '⚙️',
        title: 'Go to Admin Settings & Audit Log',
        subtitle: 'Pending approvals, audit logs, system config',
        action: () => { location.hash = '#admin'; }
      });
    }

    return commands;
  },

  _performSearch(query) {
    const q = query.toLowerCase();
    let results = [];

    if (!q) {
      // Default: show quick commands
      results = this._getDefaultCommands();
    } else {
      // 1. Match default navigation commands
      const matchedCmds = this._getDefaultCommands().filter(cmd => 
        cmd.title.toLowerCase().includes(q) || cmd.subtitle.toLowerCase().includes(q)
      );
      results = results.concat(matchedCmds);

      // 2. Search Work Requests
      const wrCache = window.apiClient?.workRequestCache;
      const allWRs = wrCache?._items ? Array.from(wrCache._items.values()) : (window.WorkflowData?._workRequests || []);
      const matchedWRs = allWRs.filter(wr => 
        (wr.title && wr.title.toLowerCase().includes(q)) ||
        (wr.id && wr.id.toLowerCase().includes(q)) ||
        (wr.trackingNumber && wr.trackingNumber.toLowerCase().includes(q))
      ).slice(0, 5).map(wr => ({
        category: 'Work Requests',
        icon: '📋',
        title: wr.title || 'Untitled Work Request',
        subtitle: `ID: ${wr.id?.slice(0, 8)}... · Status: ${wr.status || 'Active'} · ${wr.entity || 'ATA'}`,
        badge: wr.status || 'Active',
        action: () => { location.hash = `#operations/detail/${wr.id}`; }
      }));
      results = results.concat(matchedWRs);

      // 3. Search Clients
      const clientCache = window.apiClient?.clientCache;
      const allClients = clientCache?._items ? Array.from(clientCache._items.values()) : (window.Clients?._clients || []);
      const matchedClients = allClients.filter(c => 
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.tin && c.tin.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
      ).slice(0, 5).map(c => ({
        category: 'Clients',
        icon: '🏢',
        title: c.name || 'Untitled Client',
        subtitle: `TIN: ${c.tin || 'N/A'} · Contact: ${c.contactPerson || c.email || 'N/A'}`,
        badge: c.retainer ? 'Retainer' : 'Regular',
        action: () => { location.hash = '#clients'; }
      }));
      results = results.concat(matchedClients);

      // 4. Search Tasks
      const allTasks = window.WorkflowData?._tasks || [];
      const matchedTasks = allTasks.filter(t => 
        (t.title && t.title.toLowerCase().includes(q))
      ).slice(0, 5).map(t => ({
        category: 'Tasks',
        icon: '✓',
        title: t.title || 'Untitled Task',
        subtitle: `WR: ${t.workRequestId?.slice(0, 8)}... · Status: ${t.status || 'Pending'} · Priority: ${t.priority || 'Normal'}`,
        badge: t.priority || 'Normal',
        action: () => { 
          if (t.workRequestId) {
            location.hash = `#operations/detail/${t.workRequestId}?taskId=${t.id}`;
          }
        }
      }));
      results = results.concat(matchedTasks);

      // 5. Search Invoices / Billing
      const allInvoices = window.Billing?._invoices || window.Billing?._items || [];
      const matchedInvoices = allInvoices.filter(inv => 
        (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(q)) ||
        (inv.notes && inv.notes.toLowerCase().includes(q))
      ).slice(0, 4).map(inv => ({
        category: 'Billing & Invoices',
        icon: '🧾',
        title: `Invoice ${inv.invoiceNumber || '—'}`,
        subtitle: `Amount: ₱${Number(inv.total || inv.amount || 0).toLocaleString()} · Status: ${inv.status || 'Draft'}`,
        badge: inv.status || 'Issued',
        action: () => { location.hash = '#billing'; }
      }));
      results = results.concat(matchedInvoices);
    }

    this.currentResults = results;
    this._renderResults();
  },

  _renderResults() {
    this.resultsEl.innerHTML = '';

    if (this.currentResults.length === 0) {
      this.resultsEl.innerHTML = `
        <div class="command-palette-empty">
          <div class="command-palette-empty-icon">🔍</div>
          <p>No results found matching your search</p>
        </div>
      `;
      return;
    }

    let lastCategory = null;

    this.currentResults.forEach((res, index) => {
      if (res.category !== lastCategory) {
        lastCategory = res.category;
        const catHeader = document.createElement('div');
        catHeader.className = 'command-palette-category';
        catHeader.textContent = res.category;
        this.resultsEl.appendChild(catHeader);
      }

      const itemEl = document.createElement('div');
      itemEl.className = `command-palette-item ${index === this.selectedIndex ? 'selected' : ''}`;
      itemEl.setAttribute('data-index', index);

      itemEl.innerHTML = `
        <span class="cmd-item-icon">${res.icon || '•'}</span>
        <div class="cmd-item-content">
          <div class="cmd-item-title">${escapeHtml(res.title)}</div>
          ${res.subtitle ? `<div class="cmd-item-subtitle">${escapeHtml(res.subtitle)}</div>` : ''}
        </div>
        ${res.badge ? `<span class="cmd-item-badge">${escapeHtml(res.badge)}</span>` : ''}
      `;

      itemEl.addEventListener('click', () => {
        this.selectedIndex = index;
        this._executeSelected();
      });

      itemEl.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this._updateSelectionHighlight();
      });

      this.resultsEl.appendChild(itemEl);
    });

    this._updateSelectionHighlight();
  },

  _moveSelection(delta) {
    if (this.currentResults.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.currentResults.length) % this.currentResults.length;
    this._updateSelectionHighlight();
  },

  _updateSelectionHighlight() {
    const items = this.resultsEl.querySelectorAll('.command-palette-item');
    items.forEach((item, idx) => {
      if (idx === this.selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  },

  _executeSelected() {
    const item = this.currentResults[this.selectedIndex];
    if (item && typeof item.action === 'function') {
      this.close();
      item.action();
    }
  }
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => CommandPalette.init());
} else {
  CommandPalette.init();
}

window.CommandPalette = CommandPalette;
