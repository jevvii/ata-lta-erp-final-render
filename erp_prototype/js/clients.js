/**
 * Client Management Module
 * List, search, create, edit clients scoped to active entity.
 */

function formatJiraDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const date = d.getDate();
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${month} ${date}, ${year}, ${hours}:${minutes} ${ampm}`;
  } catch (e) {
    return dateStr;
  }
}

function getInitials(name) {
  if (!name) return 'U';
  return name.split(' ').map(n => n.charAt(0)).slice(0, 2).join('').toUpperCase();
}

function getUserColor(userId) {
  if (!userId) return '#7a869a';
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#0052cc', '#36b37e', '#ffab00', '#de350b', '#5243aa', '#00875a'];
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

/**
 * API-backed, entity-tagged data layer for the Clients module.
 * Mirrors WorkflowData: cache is keyed to Auth.activeEntity, supports
 * optimistic local mutations with rollback on API failure.
 */
const ClientsData = {
  _clients: null,
  _loadingPromise: null,
  _loadingEntity: null,
  _loadGeneration: 0,
  _entity: null,

  _getActiveEntity() {
    return (typeof Auth !== 'undefined' && Auth.activeEntity) || null;
  },

  _isEntityFresh() {
    return this._entity === this._getActiveEntity();
  },

  hasData() {
    return Array.isArray(this._clients) && this._isEntityFresh();
  },

  invalidate() {
    this._clients = null;
    this._loadingPromise = null;
    this._loadingEntity = null;
    this._loadGeneration++;
    this._entity = null;
    if (typeof Clients !== 'undefined') {
      Clients._skipFetchGeneration = 0;
      Clients._activeSkipGeneration = 0;
    }
  },

  async ensure() {
    if (this.hasData()) return;
    const activeEntity = this._getActiveEntity();
    // If a load is already in flight for the current entity, share it.
    if (this._loadingPromise && this._loadingEntity === activeEntity) return this._loadingPromise;
    // Otherwise start a fresh load for the active entity and tag it with a new
    // generation so stale loads cannot overwrite newer ones.
    const loadGen = ++this._loadGeneration;
    this._loadingEntity = activeEntity;
    const promise = this._load(loadGen).finally(() => {
      if (this._loadGeneration === loadGen) {
        this._loadingPromise = null;
        this._loadingEntity = null;
      }
    });
    this._loadingPromise = promise;
    return promise;
  },

  async _load(loadGen) {
    const entity = this._getActiveEntity();
    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure()
    ]);
    const res = await window.apiClient.clients.list({});
    let clients = (res.data || []).map(c => Clients.normalizeClient(c));
    clients = clients.filter(c => {
      const cEnt = (c.entity || '').toUpperCase();
      return (entity === 'ALL'
        ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(cEnt)
        : cEnt === entity.toUpperCase());
    });
    // Discard stale result if generation or entity changed while loading.
    if (loadGen !== this._loadGeneration || this._getActiveEntity() !== entity) {
      return { clients: this._clients || [] };
    }
    if (typeof Clients !== 'undefined' && Clients._activeSkipGeneration > 0 && Clients._activeSkipGeneration === Clients._skipFetchGeneration) {
      return { clients: this._clients || [] };
    }
    this._clients = clients;
    this._entity = entity;
    return { clients };
  },

  getAllClients() { return this._clients || []; },
  getClientById(id) { return (this._clients || []).find(c => c.id === id) || null; },
  getClientsWhere(predicate) { return (this._clients || []).filter(predicate); },

  addClient(client) {
    const activeEntity = this._getActiveEntity();
    if (!Array.isArray(this._clients)) this._clients = [];
    this._clients.unshift(client);
    this._entity = activeEntity;
  },

  replaceClientById(tempId, client) {
    if (!Array.isArray(this._clients)) {
      this._clients = [client];
      this._entity = this._getActiveEntity();
      return;
    }
    const idx = this._clients.findIndex(c => c.id === tempId);
    if (idx >= 0) {
      this._clients[idx] = client;
    } else {
      this._clients.unshift(client);
    }
  },

  _removeFromCache(id) {
    if (!Array.isArray(this._clients)) return;
    const idx = this._clients.findIndex(c => c.id === id);
    if (idx >= 0) this._clients.splice(idx, 1);
  },

  async updateClient(id, changes) {
    const existing = this.getClientById(id);
    const updated = { ...(existing || {}), ...changes, id };
    if (existing) Object.assign(existing, changes);
    try {
      const payload = { ...updated };
      const res = await window.apiClient.clients.update(id, payload);
      const normalized = Clients.normalizeClient(res.data);
      if (existing) Object.assign(existing, normalized);
    } catch (e) {
      console.error('Failed to update client', e);
    }
    return updated;
  },

  async deleteClient(id) {
    const idx = (this._clients || []).findIndex(c => c.id === id);
    let removed = null;
    if (idx >= 0) {
      removed = this._clients[idx];
      this._clients.splice(idx, 1);
    }
    try {
      await window.apiClient.clients.remove(id);
    } catch (e) {
      console.error('Failed to delete client', e);
      if (removed && this._clients) this._clients.splice(idx, 0, removed);
    }
  }
};

const Clients = {
  editingId: null,
  activeTab: 'active',
  _skipFetchGeneration: 0,
  _activeSkipGeneration: 0,

  _isTempId(id) {
    return typeof id === 'string' && id.startsWith('temp-');
  },

  _startOptimisticSkip() {
    this._skipFetchGeneration = (this._skipFetchGeneration || 0) + 1;
    this._activeSkipGeneration = this._skipFetchGeneration;
    if (typeof ClientsData !== 'undefined') {
      ClientsData._loadGeneration++;
    }
    return this._activeSkipGeneration;
  },

  _clearOptimisticSkipIfCurrent(generation) {
    if (this._activeSkipGeneration === generation) {
      this._activeSkipGeneration = 0;
    }
  },

  // Tell the app shell whether the cached client list is fresh for the given entity.
  hasCachedData(entity) {
    return typeof ClientsData !== 'undefined' && ClientsData.hasData() && ClientsData._entity === entity;
  },

  invalidateCache() {
    ClientsData.invalidate();
    this._skipFetchGeneration = 0;
    this._activeSkipGeneration = 0;
  },

  /**
   * Convert backend client shape to the local shape expected by the UI.
   * Backend uses relatedClientId/relationship; UI uses clientId/relationType.
   */
  normalizeClient(client) {
    if (!client) return client;
    return {
      ...client,
      relatedCompanies: (client.relatedCompanies || []).map(rc => ({
        clientId: rc.relatedClientId || rc.clientId,
        relationType: rc.relationship || rc.relationType,
        relationship: rc.relationship || rc.relationType,
        id: rc.id
      }))
    };
  },

  /**
   * Convert UI related-company shape to backend payload shape.
   */
  toApiRelatedCompanies(relatedCompanies) {
    return (relatedCompanies || []).map(rc => ({
      relatedClientId: rc.clientId || rc.relatedClientId,
      relationship: rc.relationType || rc.relationship
    })).filter(rc => rc.relatedClientId);
  },

  async render() {
    if (!this.activeTab) this.activeTab = 'active';
    const container = el('div', { class: 'page clients-tab-page' });

    // Full-page form route (#clients/form/new or #clients/form/:id) renders inline
    // with its own breadcrumb header and right-aligned Save/Cancel actions.
    if (this.editingId) {
      const isNew = this.editingId === 'new';
      let client = null;
      if (!isNew) {
        try {
          const res = await window.apiClient.clients.get(this.editingId);
          client = res.data;
        } catch (e) {
          console.error('Failed to load client for form', e);
          if (typeof showToast === 'function') showToast('Client not found or could not be loaded.', 'error');
          this.editingId = null;
          location.hash = '#clients';
          return container;
        }
      }
      const fullPageRoute = isNew ? '#clients/form/new' : `#clients/form/${this.editingId}`;

      const viewSwitcher = buildFormViewSwitcher({
        currentMode: PaneMode.FULL_PAGE,
        viewContext: 'client-form',
        onSidePeek: () => {
          const clientId = this.editingId === 'new' ? null : this.editingId;
          closeFormPanelAndRoute('#clients');
          this.showForm(clientId, PaneMode.SIDE_PEEK);
        },
        onCenterPeek: () => {
          const clientId = this.editingId === 'new' ? null : this.editingId;
          closeFormPanelAndRoute('#clients');
          this.showForm(clientId, PaneMode.CENTER_PEEK);
        },
        onNewTab: () => {
          window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
        }
      });

      container.appendChild(buildFormBreadcrumb({
        baseLabel: 'Clients',
        baseHash: '#clients',
        currentText: isNew ? 'Add Client' : (client?.name || 'Edit Client'),
        viewSwitcher,
        actions: [
          {
            text: isNew ? 'Save Client' : 'Save Changes',
            class: 'btn btn-primary btn-sm',
            type: 'submit',
            form: 'client-form'
          },
          {
            text: 'Cancel',
            class: 'btn btn-secondary btn-sm',
            onClick: () => { this.showList(); }
          }
        ]
      }));
      container.appendChild(await this.renderForm(el('div'), this.editingId, null, true));
      setTimeout(() => this.updateStickyOffsets(), 0);
      return container;
    }

    const titleBar = el('div', { class: 'page-title-bar-v2' });
    titleBar.appendChild(el('h1', { text: 'Clients' }));
    container.appendChild(titleBar);
    container.appendChild(await this.renderTabNav());

    // Toolbar (Sticky Container)
    const stickyContainer = el('div', { class: 'toolbar-sticky-container' });
    const filters = el('div', { class: 'filters-bar' });
    const searchWrapper = el('div', { style: 'position: relative; display: flex; align-items: center; width: 100%; max-width: 320px;' });

    const searchIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    searchIcon.setAttribute('width', '14');
    searchIcon.setAttribute('height', '14');
    searchIcon.setAttribute('viewBox', '0 0 24 24');
    searchIcon.setAttribute('fill', 'none');
    searchIcon.setAttribute('stroke', 'currentColor');
    searchIcon.setAttribute('stroke-width', '2.5');
    searchIcon.setAttribute('stroke-linecap', 'round');
    searchIcon.setAttribute('stroke-linejoin', 'round');
    searchIcon.setAttribute('style', 'position: absolute; left: 12px; color: var(--color-text-muted); pointer-events: none;');
    searchIcon.innerHTML = '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>';

    const search = el('input', {
      type: 'text',
      placeholder: 'Search client...',
      class: 'form-control search-input',
      style: 'width: 100%; padding-left: 36px; max-width: 320px;'
    });

    searchWrapper.appendChild(searchIcon);
    searchWrapper.appendChild(search);
    filters.appendChild(searchWrapper);
    stickyContainer.appendChild(filters);
    container.appendChild(stickyContainer);

    const content = el('div', { class: 'page-content-section' });

    const listContainer = el('div', { class: 'list-container' + (this.activeTab === 'archived' ? ' hidden' : '') });
    content.appendChild(listContainer);
    if (this.activeTab === 'active') {
      await this.renderList(listContainer, '');
    }

    const archiveContainer = el('div', { class: 'archive-container' + (this.activeTab === 'active' ? ' hidden' : '') });
    content.appendChild(archiveContainer);
    if (this.activeTab === 'archived') {
      archiveContainer.appendChild(await this.renderArchive(''));
    }

    container.appendChild(content);

    search.addEventListener('input', debounce(async () => {
      const q = search.value.trim();
      if (this.activeTab === 'active') {
        this.renderList(listContainer, q);
      } else {
        this.clearNode(archiveContainer);
        archiveContainer.appendChild(await this.renderArchive(q));
      }
    }, 200));

    setTimeout(() => this.updateStickyOffsets(), 0);
    return container;
  },

  init() {
    this.updateStickyOffsets();
  },

  updateStickyOffsets() {
    App.updateStickyOffsets();
  },

  async getClientCounts() {
    try {
      const res = await window.apiClient.clients.counts(Auth.activeEntity);
      const data = res?.data || res || {};
      return {
        activeCount: data.active ?? data.activeCount ?? 0,
        archivedCount: data.archived ?? data.archivedCount ?? 0
      };
    } catch (e) {
      console.error('Failed to get client counts', e);
      const clients = ClientsData.getAllClients();
      const activeCount = clients.filter(c => c.status !== 'Archived').length;
      const archivedCount = clients.filter(c => c.status === 'Archived').length;
      return { activeCount, archivedCount };
    }
  },

  async renderTabNav() {
    const entity = Auth.activeEntity;
    const isAdmin = Auth.user?.role === 'Admin';
    const isManagerial = Auth.isManagerial();
    let activeCount = 0;
    let archivedCount = 0;
    let rejectedCount = 0;

    const entFilter = ent => {
      const uEnt = (ent || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(uEnt);
      return uEnt === entity.toUpperCase();
    };

    try {
      await ClientsData.ensure();
      const counts = await this.getClientCounts();
      activeCount = counts.activeCount;
      archivedCount = counts.archivedCount;

      const [pendingRes, opRes] = await Promise.all([
        window.apiClient.admin.listPendingApprovals({ status: 'rejected', tableName: 'clients' }),
        window.apiClient.operationsRequests.list({ type: 'client', status: 'rejected' })
      ]);
      const rejectedClientChanges = (pendingRes.data || []).filter(pc => {
        const data = pc.proposedData || {};
        if (!entFilter(data.entity)) return false;
        if (!isManagerial && pc.submittedBy !== Auth.user.id) return false;
        return true;
      });
      const rejectedClientRequests = (opRes.data || []).filter(r => {
        if (!entFilter(r.entity)) return false;
        if (!isManagerial && r.requestedBy !== Auth.user.id) return false;
        return true;
      });
      rejectedCount = rejectedClientChanges.length + rejectedClientRequests.length;
    } catch (e) {
      console.error('Failed to load client tab counts', e);
    }
    const archiveCount = archivedCount + rejectedCount;

    const tabs = [
      { key: 'active', label: 'Active Clients', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', count: activeCount },
      { key: 'archived', label: 'Archive', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>', count: archiveCount }
    ];

    const tabNav = renderModuleTabNav(tabs, this.activeTab, (key) => {
      this.activeTab = key;
      App.handleRoute();
    });

    if (Auth.can('clients:edit') && this.activeTab === 'active') {
      const addBtn = el('button', {
        class: 'btn btn-primary btn-sm',
        style: 'margin-left: 16px; display: inline-flex; align-items: center; gap: 6px;',
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Client'
      });
      addBtn.addEventListener('click', () => this.showForm());
      tabNav.appendChild(addBtn);
    }

    return tabNav;
  },

  clearNode(node) {
    if (node && typeof node.replaceChildren === 'function') {
      node.replaceChildren();
    } else {
      while (node.firstChild) node.removeChild(node.firstChild);
    }
  },

  getFilteredClients(query) {
    let clients = ClientsData.getAllClients().filter(c => c.status !== 'Archived');
    if (query) {
      const q = query.toLowerCase();
      clients = clients.filter(c => {
        const haystack = [
          c.name,
          c.tin,
          c.tradeName,
          c.address,
          c.contactPerson,
          c.entity
        ].map(s => (s || '').toLowerCase()).join(' ');
        return haystack.includes(q);
      });
    }
    return clients;
  },

  async renderList(container, query) {
    this.clearNode(container);
    const ensurePromises = [
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure()
    ];
    const shouldSkip = this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration;
    if (!shouldSkip) {
      ensurePromises.push(ClientsData.ensure());
    }
    await Promise.all(ensurePromises);
    const clients = this.getFilteredClients(query);

    if (clients.length === 0) {
      container.appendChild(renderEmptyState('No clients found', null, { variant: 'zero-state' }));
      return;
    }

    const isAdmin = Auth.user?.role === 'Admin';

    // Floating Bulk Action Bar (Jira backlog style, only for admins)
    let bulkBar = null, countInfo = null, actionsContainer = null, closeBtn = null;
    if (isAdmin) {
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

    // Table Container
    const tableContainer = el('div', { class: 'jira-table-container' });
    const table = el('table', { class: 'jira-table' });
    tableContainer.appendChild(table);
    container.appendChild(tableContainer);

    // Thead
    const thead = el('thead');
    const headerRow = el('tr');
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Checkbox column header (only for admins)
    let selectAllCheckbox = null;
    if (isAdmin) {
      selectAllCheckbox = el('input', {
        type: 'checkbox',
        style: 'cursor: pointer; accent-color: var(--color-primary); width: 14px; height: 14px;'
      });
      const thCheckbox = el('th', { style: 'width: 40px; text-align: center;' });
      thCheckbox.appendChild(selectAllCheckbox);
      headerRow.appendChild(thCheckbox);
    }

    // Work column header (labeled "Client")
    const thWork = el('th', { class: 'jira-backlog-col-header', style: 'width: 260px;' });
    const workHeaderDiv = el('div', { class: 'jira-th-work' });
    workHeaderDiv.appendChild(el('span', { class: 'jira-header-chevron', text: '▶' }));
    workHeaderDiv.appendChild(el('span', { text: 'Client' }));
    thWork.appendChild(workHeaderDiv);
    headerRow.appendChild(thWork);

    // Client columns headers
    headerRow.appendChild(el('th', { class: 'jira-backlog-col-header', text: 'Entity', style: 'width: 80px;' }));
    headerRow.appendChild(el('th', { class: 'jira-backlog-col-header', text: 'Retainer', style: 'width: 80px;' }));
    headerRow.appendChild(el('th', { class: 'jira-backlog-col-header', text: 'TIN', style: 'width: 140px;' }));
    headerRow.appendChild(el('th', { class: 'jira-backlog-col-header', text: 'RDO Code', style: 'width: 90px;' }));
    headerRow.appendChild(el('th', { class: 'jira-backlog-col-header', text: 'Point of Contact', style: 'width: 160px;' }));
    headerRow.appendChild(el('th', { class: 'jira-backlog-col-header', text: 'Trade Name', style: 'width: 140px;' }));
    headerRow.appendChild(el('th', { class: 'jira-backlog-col-header', text: 'Address', style: 'width: 180px;' }));
    headerRow.appendChild(el('th', { class: 'jira-backlog-col-header', text: 'Related Companies', style: 'width: 180px;' }));
    headerRow.appendChild(el('th', { class: 'jira-backlog-col-header', text: 'Contact Details', style: 'width: 180px;' }));

    // Trash bin header (only for admins)
    if (isAdmin) {
      const thTrash = el('th', { style: 'width: 45px; text-align: center;' });
      const trashHeaderIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      trashHeaderIcon.setAttribute('viewBox', '0 0 24 24');
      trashHeaderIcon.setAttribute('width', '14');
      trashHeaderIcon.setAttribute('height', '14');
      trashHeaderIcon.setAttribute('fill', 'none');
      trashHeaderIcon.setAttribute('stroke', 'currentColor');
      trashHeaderIcon.setAttribute('stroke-width', '2');
      trashHeaderIcon.setAttribute('stroke-linecap', 'round');
      trashHeaderIcon.setAttribute('stroke-linejoin', 'round');
      trashHeaderIcon.innerHTML = '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>';
      thTrash.appendChild(trashHeaderIcon);
      headerRow.appendChild(thTrash);
    }

    // Tbody
    const tbody = el('tbody');
    table.appendChild(tbody);

    const checkBoxes = [];
    const rows = [];

    const updateSelection = () => {
      if (!isAdmin) return;
      const selectedIds = [];
      checkBoxes.forEach((chk, idx) => {
        if (chk.checked) {
          selectedIds.push(chk.dataset.id);
          rows[idx].classList.add('selected');
        } else {
          rows[idx].classList.remove('selected');
        }
      });

      if (selectedIds.length > 0 && bulkBar && actionsContainer) {
        countInfo.textContent = `${selectedIds.length} selected`;
        actionsContainer.replaceChildren();
        const btn = el('button', {
          class: 'btn btn-outline-danger btn-sm',
          text: 'Archive Selected'
        });
        btn.addEventListener('click', () => {
          this.bulkArchiveClients(selectedIds);
        });
        actionsContainer.appendChild(btn);
        bulkBar.classList.remove('hidden');
      } else if (bulkBar) {
        bulkBar.classList.add('hidden');
      }

      if (selectAllCheckbox) {
        const allChecked = checkBoxes.length > 0 && checkBoxes.every(c => c.checked);
        const someChecked = checkBoxes.some(c => c.checked);
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;
      }
    };

    if (isAdmin && selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', () => {
        checkBoxes.forEach(c => {
          c.checked = selectAllCheckbox.checked;
        });
        updateSelection();
      });

      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          checkBoxes.forEach(c => {
            c.checked = false;
          });
          updateSelection();
        });
      }
    }

    // Close dropdowns on document click
    const onDocClick = () => {
      document.querySelectorAll('.jira-status-dropdown-menu').forEach(m => {
        m.classList.add('hidden');
      });
    };
    document.addEventListener('click', onDocClick);

    // Render client rows
    clients.forEach((client, idx) => {
      const isRetainer = client.retainer || client.isRetainer;
      const tr = el('tr', { class: 'jira-row', 'data-item-id': client.id });
      rows.push(tr);

      // 1. Checkbox (only for admins)
      if (isAdmin) {
        const tdChk = el('td', { style: 'text-align: center;' });
        const chk = el('input', {
          type: 'checkbox',
          style: 'cursor: pointer; accent-color: var(--color-primary); width: 14px; height: 14px;',
          'data-id': client.id
        });
        checkBoxes.push(chk);
        chk.addEventListener('change', updateSelection);
        tdChk.appendChild(chk);
        tr.appendChild(tdChk);
      }

      // 2. Work (Client Key & Name)
      const tdWork = el('td');
      const workDiv = el('div', { class: 'jira-work-cell-content' });
      tdWork.appendChild(workDiv);

      const chevBtn = el('button', { class: 'jira-row-chevron-btn', text: '▶' });
      workDiv.appendChild(chevBtn);

      const typeIcon = el('span', {
        class: isRetainer ? 'jira-epic-icon' : 'jira-task-icon',
        text: isRetainer ? '⚡' : '✓'
      });
      workDiv.appendChild(typeIcon);

      const keyVal = 'CL-' + String(idx + 1).padStart(2, '0');
      const keyLink = el('a', { class: 'jira-key-link', href: '#clients', text: keyVal });
      keyLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.showForm(client.id);
      });
      workDiv.appendChild(keyLink);

      const nameText = el('span', { class: 'jira-name-text', text: client.name });
      workDiv.appendChild(nameText);
      tr.appendChild(tdWork);

      // 3. Entity
      const tdEntity = el('td');
      const entityBadge = el('span', {
        class: 'badge badge-' + (client.entity === 'ATA' ? 'info' : 'success'),
        text: client.entity
      });
      tdEntity.appendChild(entityBadge);
      tr.appendChild(tdEntity);

      // 4. Retainer
      const tdRetainer = el('td', { style: 'text-align: center;' });
      if (isRetainer) {
        const retainerIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        retainerIcon.setAttribute('width', '14');
        retainerIcon.setAttribute('height', '14');
        retainerIcon.setAttribute('viewBox', '0 0 24 24');
        retainerIcon.setAttribute('fill', 'none');
        retainerIcon.setAttribute('stroke', '#006644');
        retainerIcon.setAttribute('stroke-width', '3');
        retainerIcon.setAttribute('stroke-linecap', 'round');
        retainerIcon.setAttribute('stroke-linejoin', 'round');
        retainerIcon.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
        tdRetainer.appendChild(retainerIcon);
      }
      tr.appendChild(tdRetainer);

      // 5. TIN
      const tdTin = el('td', { text: client.tin || '—' });
      tr.appendChild(tdTin);

      // 6. RDO Code
      const tdRdo = el('td', { text: client.rdoCode || '—' });
      tr.appendChild(tdRdo);

      // 7. Point of Contact
      const tdAssignee = el('td');
      const pocUser = client.contactUserId ? window.apiClient.userCache.getById(client.contactUserId) : null;
      if (pocUser) {
        const avatarCell = el('div', { class: 'jira-avatar-cell' });
        const initials = getInitials(pocUser.name);
        const color = getUserColor(pocUser.id);
        const avatarCircle = el('span', { class: 'jira-avatar-circle', text: initials, style: `background: ${color};` });
        const nameSpan = el('span', { text: pocUser.name });
        avatarCell.appendChild(avatarCircle);
        avatarCell.appendChild(nameSpan);
        tdAssignee.appendChild(avatarCell);
      } else if (client.contactPerson) {
        const avatarCell = el('div', { class: 'jira-avatar-cell' });
        const initials = getInitials(client.contactPerson);
        const avatarCircle = el('span', { class: 'jira-avatar-circle', text: initials, style: 'background: #7a869a;' });
        const nameSpan = el('span', { text: client.contactPerson });
        avatarCell.appendChild(avatarCircle);
        avatarCell.appendChild(nameSpan);
        tdAssignee.appendChild(avatarCell);
      } else {
        const avatarCell = el('div', { class: 'jira-avatar-cell' });
        const avatarCircle = el('span', { class: 'jira-avatar-unassigned', text: '👤' });
        const nameSpan = el('span', { text: 'Unassigned', style: 'color: var(--color-text-muted);' });
        avatarCell.appendChild(avatarCircle);
        avatarCell.appendChild(nameSpan);
        tdAssignee.appendChild(avatarCell);
      }
      tr.appendChild(tdAssignee);

      // 8. Trade Name
      const tdTradeName = el('td', { text: client.tradeName || '—' });
      tr.appendChild(tdTradeName);

      // 9. Address
      const tdAddress = el('td', { text: client.address || '—' });
      tr.appendChild(tdAddress);

      // 10. Related Companies
      const rcList = (client.relatedCompanies || []).map(rc => {
        const rcClient = window.apiClient.clientCache.getById(rc.clientId);
        return (rcClient?.name || '—') + ' (' + rc.relationType + ')';
      }).join(', ') || '—';
      const tdRc = el('td', { text: rcList });
      tr.appendChild(tdRc);

      // 11. Contact Details
      const cdList = (client.contactDetails || []).map(cd => cd.type + ': ' + cd.value).join(', ') || '—';
      const tdCd = el('td', { text: cdList });
      tr.appendChild(tdCd);

      // 12. Trash (Archive Action, only for admins)
      if (isAdmin) {
        const tdTrash = el('td', { style: 'text-align: center;' });
        const trashBtn = el('button', { class: 'jira-trash-btn', title: 'Archive Client' });
        const trashSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        trashSvg.setAttribute('viewBox', '0 0 24 24');
        trashSvg.setAttribute('width', '14');
        trashSvg.setAttribute('height', '14');
        trashSvg.setAttribute('fill', 'none');
        trashSvg.setAttribute('stroke', 'currentColor');
        trashSvg.setAttribute('stroke-width', '2');
        trashSvg.setAttribute('stroke-linecap', 'round');
        trashSvg.setAttribute('stroke-linejoin', 'round');
        trashSvg.innerHTML = '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>';
        trashBtn.appendChild(trashSvg);
        tdTrash.appendChild(trashBtn);
        tr.appendChild(tdTrash);

        trashBtn.addEventListener('click', () => {
          this.archiveClientDirectly(client.id);
        });
      }

      tbody.appendChild(tr);

      // Accordion Row
      const accordionRow = el('tr', { class: 'jira-accordion-tr hidden' });
      const accordionTd = el('td', { colspan: isAdmin ? '12' : '10', class: 'jira-accordion-td' });
      accordionRow.appendChild(accordionTd);
      tbody.appendChild(accordionRow);

      // Build accordion content
      const detailsContainer = el('div', { class: 'jira-accordion-details-container' });
      accordionTd.appendChild(detailsContainer);

      // Left section (Client details)
      const leftSec = el('div', { class: 'jira-accordion-details-section' });
      leftSec.appendChild(el('div', { class: 'jira-accordion-details-title', text: 'Client Details' }));
      const leftGrid = el('div', { class: 'jira-details-grid' });
      leftSec.appendChild(leftGrid);

      // Helper to add grid row
      const addGridRow = (label, val) => {
        leftGrid.appendChild(el('div', { class: 'jira-details-lbl', text: label }));
        leftGrid.appendChild(el('div', { class: 'jira-details-val', text: val || '—' }));
      };

      addGridRow('Trade Name', client.tradeName);
      addGridRow('TIN', client.tin);
      addGridRow('RDO Code', client.rdoCode);
      addGridRow('Entity', client.entity);
      addGridRow('Business Address', client.address);

      const relCos = (client.relatedCompanies || []).map(rc => {
        const rcClient = window.apiClient.clientCache.getById(rc.clientId);
        return (rcClient?.name || '—') + ' (' + rc.relationType + ')';
      }).join(', ');
      addGridRow('Related Companies', relCos);

      const contactDets = (client.contactDetails || []).map(cd => cd.type + ': ' + cd.value + (cd.label ? ` (${cd.label})` : '')).join(', ');
      addGridRow('Contact Details', contactDets);

      detailsContainer.appendChild(leftSec);

      // Right section (Work requests)
      const rightSec = el('div', { class: 'jira-accordion-details-section' });
      const clientWrs = (window.apiClient.workRequestCache._wrs || []).filter(wr => wr.clientId === client.id);
      rightSec.appendChild(el('div', { class: 'jira-accordion-details-title', text: `Work Requests (${clientWrs.length})` }));
      detailsContainer.appendChild(rightSec);

      if (clientWrs.length === 0) {
        rightSec.appendChild(el('div', { style: 'color: var(--color-text-muted); font-size: 13px;', text: 'No work requests assigned.' }));
      } else {
        const childWrsList = el('div', { class: 'jira-details-list' });
        const sortedWrs = [...clientWrs].sort((a, b) => sortByDate(a, b, 'createdAt'));
        const wrSeqMap = new Map(sortedWrs.map((wr, i) => [wr.id, i + 1]));
        clientWrs.forEach((wr, wrIdx) => {
          const wrItem = el('div', { class: 'jira-details-list-item' });
          const wrSeq = wrSeqMap.get(wr.id) || (wrIdx + 1);
          const wrKey = 'WR-' + String(wrSeq).padStart(2, '0');
          const wrLink = el('a', { class: 'jira-details-list-item-key', href: `#operations/detail/${wr.id}`, text: wrKey });
          const wrTitle = el('span', { class: 'jira-details-list-item-title', text: wr.title });
          const wrStatus = el('span', { class: 'badge badge-info jira-details-list-item-status', text: wr.status });

          wrItem.appendChild(wrLink);
          wrItem.appendChild(wrTitle);
          wrItem.appendChild(wrStatus);
          childWrsList.appendChild(wrItem);
        });
        rightSec.appendChild(childWrsList);
      }

      // Chevron expand event
      let expanded = false;
      chevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        if (expanded) {
          chevBtn.classList.add('expanded');
          chevBtn.textContent = '▼';
          accordionRow.classList.remove('hidden');
        } else {
          chevBtn.classList.remove('expanded');
          chevBtn.textContent = '▶';
          accordionRow.classList.add('hidden');
        }
      });
    });

    // Footer
    const footer = el('div', { class: 'jira-table-footer' });
    container.appendChild(footer);

    const footerLeft = el('button', { class: 'jira-footer-create-btn', html: '<span style="font-size:14px; font-weight:bold;">+</span> Create' });
    footerLeft.addEventListener('click', () => {
      this.showForm();
    });
    footer.appendChild(footerLeft);

    const footerCenter = el('div', { class: 'jira-footer-center' });
    const countText = `${clients.length} of ${clients.length}`;
    footerCenter.appendChild(el('span', { text: countText }));

    const refreshBtn = el('button', { class: 'jira-footer-refresh-btn', title: 'Refresh list' });
    const refreshSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    refreshSvg.setAttribute('viewBox', '0 0 24 24');
    refreshSvg.setAttribute('width', '14');
    refreshSvg.setAttribute('height', '14');
    refreshSvg.setAttribute('fill', 'none');
    refreshSvg.setAttribute('stroke', 'currentColor');
    refreshSvg.setAttribute('stroke-width', '2');
    refreshSvg.setAttribute('stroke-linecap', 'round');
    refreshSvg.setAttribute('stroke-linejoin', 'round');
    refreshSvg.innerHTML = '<path d="M23 4v6h-6M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>';
    refreshBtn.appendChild(refreshSvg);
    footerCenter.appendChild(refreshBtn);
    footer.appendChild(footerCenter);

    refreshBtn.addEventListener('click', () => {
      if (this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration) {
        return;
      }
      ClientsData.invalidate();
      this.renderList(container, query);
    });
  },

  async showForm(clientId, mode = null) {
    this.editingId = clientId || 'new';
    const isNew = this.editingId === 'new';
    let client = null;
    if (!isNew) {
      try {
        const res = await window.apiClient.clients.get(clientId);
        client = this.normalizeClient(res.data);
      } catch (e) {
        console.error('Failed to load client form', e);
        if (typeof showToast === 'function') showToast('Client not found or could not be loaded.', 'error');
        this.editingId = null;
        this.showList();
        return;
      }
    }
    const fullPageRoute = isNew ? '#clients/form/new' : `#clients/form/${clientId}`;

    const formContainer = el('div', { class: 'form-container' });
    await this.renderForm(formContainer, this.editingId, client);

    openFormPanel({
      icon: '🏢',
      title: isNew ? 'Add Client' : (client?.name || 'Edit Client'),
      formContent: formContainer,
      formId: 'client-form',
      mode,
      viewContext: 'client-form',
      fullPageRoute,
      newTabRoute: fullPageRoute,
      actions: [
        { text: isNew ? 'Save Client' : 'Save Changes', class: 'btn btn-primary', type: 'submit', form: 'client-form', testId: 'client-save' },
        { text: 'Cancel', class: 'btn btn-secondary', onClick: () => this.showList(), testId: 'client-cancel' }
      ]
    });
  },

  async renderForm(container, clientId, clientOrNull = null, hideHeader = false) {
    let client = clientOrNull;
    if (!client && clientId && clientId !== 'new') {
      try {
        const res = await window.apiClient.clients.get(clientId);
        client = this.normalizeClient(res.data);
      } catch (e) {
        console.error('Failed to load client form', e);
      }
    }
    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure()
    ]);
    this.clearNode(container);

    // Inline action bar for embedded/list views. Full-page forms render their own
    // Save/Cancel actions in the breadcrumb, so suppress this internal header.
    if (!hideHeader) {
      const headerBar = el('div', { class: 'form-header-bar' });
      const headerActions = el('div', { class: 'form-actions-top' });
      const saveBtnTop = el('button', { type: 'submit', form: 'client-form', class: 'btn btn-primary', text: client ? 'Save Changes' : 'Save Client' });
      headerActions.appendChild(saveBtnTop);
      const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel' });
      cancelBtn.addEventListener('click', () => this.showList());
      headerActions.appendChild(cancelBtn);
      headerBar.appendChild(headerActions);
      container.appendChild(headerBar);
    }

    const form = el('form', { id: 'client-form', class: 'form-stacked notion-form' });

    // ── Identity free-form block ──
    const identitySection = el('div', { class: 'notion-freeform notion-freeform--title' });
    identitySection.appendChild(el('label', { class: 'notion-section-label', text: 'Client Name' }));
    const nameInput = el('input', { type: 'text', name: 'name', class: 'notion-freeform-input notion-title-input', placeholder: 'Taxpayer / company name', required: true, value: client ? (client.name || '') : '' });
    identitySection.appendChild(nameInput);
    if (!client) {
      setTimeout(() => { nameInput.focus(); nameInput.select(); }, 60);
    }
    form.appendChild(identitySection);

    // ── Property grid ──
    const propsGrid = el('div', { class: 'notion-property-grid' });

    const tinProp = el('div', { class: 'notion-prop' });
    tinProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> TIN' }));
    const tinInput = el('input', { type: 'text', name: 'tin', class: 'notion-prop-input', placeholder: 'XXX-XXX-XXX-XXXXX', required: true, value: client ? (client.tin || '') : '' });
    tinInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length > 14) {
        value = value.substring(0, 14);
      }
      let formatted = '';
      if (value.length > 0) {
        formatted += value.substring(0, 3);
      }
      if (value.length > 3) {
        formatted += '-' + value.substring(3, 6);
      }
      if (value.length > 6) {
        formatted += '-' + value.substring(6, 9);
      }
      if (value.length > 9) {
        formatted += '-' + value.substring(9, 14);
      }
      e.target.value = formatted;
    });
    tinProp.appendChild(tinInput);
    propsGrid.appendChild(tinProp);

    const tradeProp = el('div', { class: 'notion-prop' });
    tradeProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22h20M2 6h20M2 10h20M2 14h20"/></svg> Trade Name' }));
    tradeProp.appendChild(el('input', { type: 'text', name: 'tradeName', class: 'notion-prop-input', placeholder: 'e.g. DBA name', value: client ? (client.tradeName || '') : '' }));
    propsGrid.appendChild(tradeProp);

    const entityProp = el('div', { class: 'notion-prop' });
    entityProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Entity' }));
    const entitySel = el('select', { name: 'entity', class: 'notion-prop-select', required: true });
    ['ATA', 'LTA'].forEach(e => {
      const opt = el('option', { value: e, text: e });
      if (client ? client.entity === e : Auth.activeEntity === e) opt.selected = true;
      entitySel.appendChild(opt);
    });
    entityProp.appendChild(entitySel);
    propsGrid.appendChild(entityProp);

    const rdoProp = el('div', { class: 'notion-prop' });
    rdoProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> RDO Code' }));
    const rdoInput = el('input', { type: 'text', name: 'rdoCode', class: 'notion-prop-input', placeholder: 'e.g. 034A', maxlength: '4', value: client ? (client.rdoCode || '') : '' });
    rdoInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    });
    rdoProp.appendChild(rdoInput);
    propsGrid.appendChild(rdoProp);

    const pocProp = el('div', { class: 'notion-prop' });
    pocProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Point of Contact' }));
    const pocInput = el('input', { type: 'text', name: 'pointOfContactInput', class: 'notion-prop-input', list: 'staff-list', placeholder: '— Select or type Staff —' });
    const datalist = el('datalist', { id: 'staff-list' });
    const staffUsers = window.apiClient.userCache._users || [];
    staffUsers.filter(u => {
      const userEntities = (u.entities || []).map(e => e.toUpperCase());
      return Auth.ALL_ROLES.includes(u.role) && userEntities.includes(Auth.activeEntity.toUpperCase());
    }).forEach(u => { datalist.appendChild(el('option', { value: u.name + ' (' + u.role + ')' })); });
    if (client) {
      if (client.contactUserId) {
        const u = window.apiClient.userCache.getById(client.contactUserId);
        if (u) pocInput.value = u.name + ' (' + u.role + ')';
      } else if (client.contactPerson) {
        pocInput.value = client.contactPerson;
      }
    }
    pocProp.appendChild(pocInput);
    pocProp.appendChild(datalist);
    propsGrid.appendChild(pocProp);

    const retainerProp = el('div', { class: 'notion-prop notion-prop-checkbox' });
    const retainerLabel = el('label', { class: 'checkbox-label' });
    const retainerCb = el('input', { type: 'checkbox', name: 'retainer' });
    if (client && (client.retainer || client.isRetainer)) retainerCb.checked = true;
    retainerLabel.appendChild(retainerCb);
    retainerLabel.appendChild(document.createTextNode(' On retainer'));
    retainerProp.appendChild(retainerLabel);
    propsGrid.appendChild(retainerProp);

    form.appendChild(propsGrid);

    // Address free-form
    const addrSection = el('div', { class: 'notion-freeform' });
    addrSection.appendChild(el('label', { class: 'notion-section-label', text: 'Business Address' }));
    addrSection.appendChild(el('input', { type: 'text', name: 'address', class: 'notion-freeform-input', placeholder: 'Enter business address', value: client ? (client.address || '') : '' }));
    form.appendChild(addrSection);

    // Contact Details (multi-entry) — Notion-style
    form.appendChild(el('h3', { class: 'notion-section-heading', text: 'Contact Details' }));
    const cdSection = el('div', { class: 'notion-line-items' });
    const cdContainer = el('div', { id: 'contact-details-container' });
    const contactDetails = client && Array.isArray(client.contactDetails) ? client.contactDetails : [];
    contactDetails.forEach((cd, idx) => this.addContactDetailRow(cdContainer, cd, idx));
    cdSection.appendChild(cdContainer);
    const addCdBtn = el('button', { type: 'button', class: 'notion-add-line-item', text: '+ Add Contact Detail' });
    addCdBtn.addEventListener('click', () => this.addContactDetailRow(cdContainer, null, cdContainer.childElementCount));
    cdSection.appendChild(addCdBtn);
    form.appendChild(cdSection);

    // Related Companies (multi-entry) — Notion-style
    form.appendChild(el('h3', { class: 'notion-section-heading', text: 'Related Companies' }));
    const rcSection = el('div', { class: 'notion-line-items' });
    const rcContainer = el('div', { id: 'related-companies-container' });
    const relatedCompanies = client && Array.isArray(client.relatedCompanies) ? client.relatedCompanies : [];
    relatedCompanies.forEach((rc, idx) => this.addRelatedCompanyRow(rcContainer, rc, idx));
    rcSection.appendChild(rcContainer);
    const addRcBtn = el('button', { type: 'button', class: 'notion-add-line-item', text: '+ Add Related Company' });
    addRcBtn.addEventListener('click', () => this.addRelatedCompanyRow(rcContainer, null, rcContainer.childElementCount));
    rcSection.appendChild(addRcBtn);
    form.appendChild(rcSection);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitForm(form);
    });

    container.appendChild(form);
    return container;
  },

  addContactDetailRow(container, data, idx) {
    const row = el('div', { class: 'notion-line-item-row notion-sub-row' });

    const dragHandle = el('div', {
      class: 'notion-line-item-drag',
      title: 'Drag to reorder',
      html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>'
    });
    row.appendChild(dragHandle);

    const typeSel = el('select', { class: 'notion-line-item-type', name: 'cd-type-' + idx, style: 'flex: 0 0 100px;' });
    ['mobile', 'landline', 'email'].forEach(t => {
      typeSel.appendChild(el('option', { value: t, text: t.charAt(0).toUpperCase() + t.slice(1) }));
    });
    if (data && data.type) typeSel.value = data.type;
    const valueInput = el('input', { type: 'text', class: 'notion-line-item-desc', placeholder: 'Value', name: 'cd-value-' + idx, value: data ? (data.value || '') : '' });

    const updatePlaceholder = () => {
      if (typeSel.value === 'mobile') {
        valueInput.placeholder = 'e.g. 09123456789 (11 digits)';
        valueInput.maxLength = 11;
      } else if (typeSel.value === 'landline') {
        valueInput.placeholder = 'e.g. 123456789 (9 digits)';
        valueInput.maxLength = 9;
      } else if (typeSel.value === 'email') {
        valueInput.placeholder = 'e.g. user@theiremail.com';
        valueInput.removeAttribute('maxLength');
      }
      if (valueInput.value) valueInput.dispatchEvent(new Event('input'));
    };

    valueInput.addEventListener('input', (e) => {
      if (typeSel.value === 'mobile' || typeSel.value === 'landline') {
        e.target.value = e.target.value.replace(/\D/g, '');
      }
    });

    typeSel.addEventListener('change', updatePlaceholder);
    updatePlaceholder();

    const labelInput = el('input', { type: 'text', class: 'notion-line-item-desc', style: 'flex: 0 0 140px;', placeholder: 'Label', name: 'cd-label-' + idx, value: data ? (data.label || '') : '' });
    const removeBtn = el('button', {
      type: 'button',
      class: 'notion-line-item-remove',
      title: 'Remove',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    });
    removeBtn.addEventListener('click', () => row.remove());
    row.appendChild(typeSel);
    row.appendChild(valueInput);
    row.appendChild(labelInput);
    row.appendChild(removeBtn);
    container.appendChild(row);
  },

  addRelatedCompanyRow(container, data, idx) {
    const row = el('div', { class: 'notion-line-item-row notion-sub-row' });

    const dragHandle = el('div', {
      class: 'notion-line-item-drag',
      title: 'Drag to reorder',
      html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>'
    });
    row.appendChild(dragHandle);

    const entity = Auth.activeEntity;
    const clientSel = el('select', { class: 'notion-line-item-type', name: 'rc-client-' + idx, style: 'flex: 1 1 auto; min-width: 160px;' });
    clientSel.appendChild(el('option', { value: '', text: '— Select Client —' }));
    const allClients = window.apiClient.clientCache._clients || [];
    allClients.filter(c => {
      return matchesEntity(c.entity, entity);
    }).forEach(c => {
      if (this.editingId && c.id === this.editingId) return;
      clientSel.appendChild(el('option', { value: c.id, text: c.name }));
    });
    if (data && data.clientId) clientSel.value = data.clientId;
    const relSel = el('select', { class: 'notion-line-item-type', name: 'rc-relation-' + idx, style: 'flex: 0 0 150px;' });
    ['Parent', 'Subsidiary', 'Sister Company', 'Affiliate'].forEach(r => {
      relSel.appendChild(el('option', { value: r, text: r }));
    });
    if (data && data.relationType) relSel.value = data.relationType;
    const removeBtn = el('button', {
      type: 'button',
      class: 'notion-line-item-remove',
      title: 'Remove',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    });
    removeBtn.addEventListener('click', () => row.remove());
    row.appendChild(clientSel);
    row.appendChild(relSel);
    row.appendChild(removeBtn);
    container.appendChild(row);
  },

  showList() {
    this.editingId = null;
    closeFormPanelAndRoute('#clients');
  },

  async submitForm(form) {
    if (!validateRequiredFields(form)) return;
    const isResubmitting = typeof PendingChanges !== 'undefined' && PendingChanges.editingPendingId;

    const data = Object.fromEntries(new FormData(form).entries());

    if (!data.tin || !/^\d{3}-\d{3}-\d{3}-\d{5}$/.test(data.tin)) {
      const tinField = form.querySelector('[name="tin"]');
      showFieldError(tinField, 'TIN must be in format XXX-XXX-XXX-XXXXX.');
      return;
    }

    if (data.rdoCode && !/^[a-zA-Z0-9]{1,4}$/.test(data.rdoCode)) {
      const rdoField = form.querySelector('[name="rdoCode"]');
      showFieldError(rdoField, 'RDO Code must be up to 4 alphanumeric characters.');
      return;
    }

    const entityRadio = form.querySelector('[name="entity"]:checked, select[name="entity"]');
    if (!entityRadio || !entityRadio.value) {
      showFieldError(entityRadio || form.querySelector('[name="entity"]'), 'Entity is required.');
      return;
    }
    // Collect contact details
    const contactDetails = [];
    let hasContactError = false;
    const cdContainer = document.getElementById('contact-details-container');
    if (cdContainer) {
      cdContainer.querySelectorAll('.notion-sub-row').forEach(row => {
        const valueInput = row.querySelector('input[name^="cd-value-"]');
        const labelInput = row.querySelector('input[name^="cd-label-"]');
        if (!valueInput || !labelInput) return;

        const type = row.querySelector('select[name^="cd-type-"]')?.value;
        const value = valueInput.value.trim();
        const label = labelInput.value.trim();

        if (value || label) {
          if (!label) {
            showFieldError(labelInput, 'Label is required.');
            hasContactError = true;
          }
          if (!value) {
            showFieldError(valueInput, 'Value is required.');
            hasContactError = true;
          } else {
            if (type === 'mobile' && !/^\d{11}$/.test(value)) {
              showFieldError(valueInput, 'Mobile must be exactly 11 digits.');
              hasContactError = true;
            } else if (type === 'landline' && !/^\d{9}$/.test(value)) {
              showFieldError(valueInput, 'Landline must be exactly 9 digits.');
              hasContactError = true;
            } else if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
              showFieldError(valueInput, 'Please enter a valid email address.');
              hasContactError = true;
            }
          }
          contactDetails.push({ type, value, label });
        }
      });
    }

    if (hasContactError) return;

    // Collect related companies
    const relatedCompanies = [];
    const rcContainer = document.getElementById('related-companies-container');
    if (rcContainer) {
      rcContainer.querySelectorAll('.notion-sub-row').forEach(row => {
        const clientId = row.querySelector('select[name^="rc-client-"]')?.value;
        const relationType = row.querySelector('select[name^="rc-relation-"]')?.value;
        if (clientId && relationType) {
          relatedCompanies.push({ clientId, relationType });
        }
      });
    }

    const pocInputValue = (data.pointOfContactInput || '').trim();
    let contactUserId = null;

    if (pocInputValue) {
      const matchedUser = window.apiClient.userCache._users?.find(u => (u.name + ' (' + u.role + ')') === pocInputValue);
      if (matchedUser) {
        contactUserId = matchedUser.id;
      }
    }

    const record = {
      name: data.name.trim(),
      tin: data.tin.trim(),
      rdoCode: data.rdoCode ? data.rdoCode.trim().toUpperCase() : '',
      address: data.address ? data.address.trim() : '',
      tradeName: data.tradeName ? data.tradeName.trim() : '',
      entity: data.entity || (Auth.activeEntity !== 'ALL' ? Auth.activeEntity : 'ATA'),
      retainer: !!form.querySelector('input[name="retainer"]:checked'),
      contactDetails,
      relatedCompanies: this.toApiRelatedCompanies(relatedCompanies)
    };
    if (contactUserId) record.contactUserId = contactUserId;

    const isNew = !this.editingId || this.editingId === 'new';
    const canEditDirectly = Auth.can('clients:edit');
    const isApproved = canEditDirectly || Auth.user.role === 'Admin' || Auth.isManagerial();

    if (isNew) {
      const optimisticId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
      const now = new Date().toISOString();
      const optimisticClient = this.normalizeClient({
        ...record,
        id: optimisticId,
        status: 'Active',
        createdAt: now,
        updatedAt: now
      });

      const createGeneration = this._startOptimisticSkip();
      ClientsData.addClient(optimisticClient);
      this.editingId = null;
      closeFormPanelAndRoute('#clients');

      let serverClient = null;
      try {
        const res = await window.apiClient.clients.create(record);
        serverClient = this.normalizeClient(res.data);
        ClientsData.replaceClientById(optimisticId, serverClient);
        // Add/update the shared client cache so pickers/dropdowns stay usable.
        if (window.apiClient?.clientCache) {
          if (!Array.isArray(window.apiClient.clientCache._clients)) {
            window.apiClient.clientCache._clients = [serverClient];
          } else {
            const idx = window.apiClient.clientCache._clients.findIndex(c => c.id === serverClient.id);
            if (idx >= 0) window.apiClient.clientCache._clients[idx] = serverClient;
            else window.apiClient.clientCache._clients.push(serverClient);
          }
          window.apiClient.clientCache._loadedAt = Date.now();
        }
        if (typeof Dashboard !== 'undefined') {
          if (typeof Dashboard.invalidateCache === 'function') Dashboard.invalidateCache();
          else if (Dashboard._dataCache) Dashboard._dataCache = null;
        }
        this._clearOptimisticSkipIfCurrent(createGeneration);
        await App.handleRoute();
        Workflow.showMessage('Client Created', `Client ${serverClient.name || record.name} has been successfully created.`, 'success');
      } catch (e) {
        console.error('Failed to create client', e);
        ClientsData._removeFromCache(optimisticId);
        this._clearOptimisticSkipIfCurrent(createGeneration);
        await App.handleRoute();
        Workflow.showMessage('Error', e.message || 'Unable to create client.', 'error');
        return;
      }
      return;
    }

    try {
      await window.apiClient.clients.update(this.editingId, record);
      // Patch the shared cache in place rather than wiping it, so dropdowns stay populated.
      if (window.apiClient?.clientCache && Array.isArray(window.apiClient.clientCache._clients)) {
        const idx = window.apiClient.clientCache._clients.findIndex(c => c.id === this.editingId);
        if (idx >= 0) {
          window.apiClient.clientCache._clients[idx] = { ...window.apiClient.clientCache._clients[idx], ...record, id: this.editingId };
        }
      }
      this.invalidateCache();
    } catch (e) {
      Workflow.showMessage('Save Client', e.message || 'Unable to save client.', 'error');
      return;
    }

    const msgConfig = {
      title: isNew ? 'Client Created' : 'Client Updated',
      message: isApproved 
        ? `Client ${record.name} has been successfully ${isNew ? 'created' : 'updated'}.` 
        : `Client ${record.name} ${isNew ? 'creation' : 'update'} request has been submitted for Admin approval.`,
      type: 'success'
    };
    const targetRoute = isResubmitting ? '#admin' : '#clients';
    closeFormPanelAndRoute(targetRoute, msgConfig);
  },

  async archiveClientDirectly(clientId) {
    if (Auth.user?.role !== 'Admin') {
      Workflow.showMessage('Permission Denied', 'Only Admins can archive clients.', 'danger');
      return;
    }
    await ClientsData.ensure();
    const client = ClientsData.getClientById(clientId);
    Workflow.showConfirm('Archive Client',
      'Are you sure you want to archive this client? This will cancel all related work requests and archive all associated documents.',
      async () => {
        const archiveGeneration = this._startOptimisticSkip();
        const originalStatus = client ? client.status : null;
        if (client) client.status = 'Archived';
        App.handleRoute();
        try {
          await window.apiClient.clients.remove(clientId);
          window.apiClient.clientCache.invalidate();
          this._clearOptimisticSkipIfCurrent(archiveGeneration);
          await App.handleRoute();
          Workflow.showMessage('Archived', 'Client has been archived.', 'success');
        } catch (e) {
          if (client && originalStatus !== null) client.status = originalStatus;
          this._clearOptimisticSkipIfCurrent(archiveGeneration);
          await App.handleRoute();
          Workflow.showMessage('Error', e.message || 'Unable to archive client.', 'error');
        }
      },
      'warning'
    );
  },

  async archiveClientRequest(clientId) {
    if (Auth.user?.role !== 'Admin') {
      Workflow.showMessage('Permission Denied', 'Only Admins can archive clients.', 'danger');
      return;
    }
    // Check if there is already a pending change to archive this client
    try {
      const pendingRes = await window.apiClient.admin.listPendingApprovals({ status: 'pending', tableName: 'clients', parentRecordId: clientId });
      const pending = (pendingRes.data || []).filter(pc => pc.proposedData && pc.proposedData.status === 'Archived');
      if (pending.length > 0) {
        Workflow.showMessage('Request Pending', 'An archive request for this client is already pending approval.', 'info');
        return;
      }
    } catch (e) {
      console.error('Failed to check pending client archive requests', e);
    }

    Workflow.showConfirm('Request Archive',
      'Are you sure you want to request archiving this client? This requires Admin approval.',
      async () => {
        let client;
        try {
          const res = await window.apiClient.clients.get(clientId);
          client = res.data;
        } catch (e) {
          console.error('Failed to load client for archive request', e);
          return;
        }
        if (!client) return;

        const proposed = deepClone(client);
        proposed.status = 'Archived';
        proposed.updatedAt = new Date().toISOString();

        const pc = {
          tableName: 'clients',
          parentRecordId: clientId,
          proposedData: proposed
        };
        try {
          await window.apiClient.pendingApprovals.create(pc);
        } catch (e) {
          Workflow.showMessage('Archive Request Failed', e.message || 'Unable to submit archive request.', 'error');
          return;
        }

        Workflow.showMessage('Archive Requested', 'Archive request submitted for Admin approval.', 'success');
        App.handleRoute();
      },
      'warning'
    );
  },

  async bulkArchiveClients(clientIds) {
    if (Auth.user?.role !== 'Admin') {
      Workflow.showMessage('Permission Denied', 'Only Admins can archive clients.', 'danger');
      return;
    }
    if (!clientIds || clientIds.length === 0) return;
    await this.archiveClientsDirectly(clientIds);
  },


  async archiveClientsDirectly(clientIds) {
    if (Auth.user?.role !== 'Admin') {
      Workflow.showMessage('Permission Denied', 'Only Admins can archive clients.', 'danger');
      return;
    }
    if (!clientIds || clientIds.length === 0) return;
    const label = clientIds.length === 1 ? 'this client' : `these ${clientIds.length} clients`;
    Workflow.showConfirm('Archive Clients',
      `Are you sure you want to archive ${label}? This will cancel all related work requests and archive all associated documents.`,
      async () => {
        await ClientsData.ensure();
        const archiveGeneration = this._startOptimisticSkip();
        const originals = [];
        clientIds.forEach(id => {
          const client = ClientsData.getClientById(id);
          if (client) {
            originals.push({ id, status: client.status });
            client.status = 'Archived';
          }
        });
        App.handleRoute();

        let failedCount = 0;
        let lastError = null;
        for (const clientId of clientIds) {
          try {
            await window.apiClient.clients.remove(clientId);
          } catch (e) {
            failedCount++;
            lastError = e;
            const client = ClientsData.getClientById(clientId);
            const original = originals.find(o => o.id === clientId);
            if (client && original) client.status = original.status;
          }
        }

        window.apiClient.clientCache.invalidate();
        this._clearOptimisticSkipIfCurrent(archiveGeneration);
        await App.handleRoute();
        if (failedCount > 0) {
          Workflow.showMessage('Error', lastError?.message || `Unable to archive ${failedCount} client(s).`, 'error');
        } else {
          Workflow.showMessage('Archived', `${clientIds.length} client(s) archived.`, 'success');
        }
      },
      'warning'
    );
  },

  async archiveClientsRequest(clientIds) {
    if (Auth.user?.role !== 'Admin') {
      Workflow.showMessage('Permission Denied', 'Only Admins can archive clients.', 'danger');
      return;
    }
    if (!clientIds || clientIds.length === 0) return;
    const label = clientIds.length === 1 ? 'this client' : `these ${clientIds.length} clients`;
    Workflow.showConfirm('Request Bulk Archive',
      `Are you sure you want to request archiving ${label}? This requires Admin approval.`,
      async () => {
        let requestedCount = 0;
        let lastError = null;
        for (const clientId of clientIds) {
          try {
            const pendingRes = await window.apiClient.admin.listPendingApprovals({ status: 'pending', tableName: 'clients', parentRecordId: clientId });
            const pending = (pendingRes.data || []).filter(pc => pc.proposedData && pc.proposedData.status === 'Archived');
            if (pending.length > 0) continue;

            const clientRes = await window.apiClient.clients.get(clientId);
            const client = clientRes.data;
            if (!client) continue;

            const proposed = deepClone(client);
            proposed.status = 'Archived';
            proposed.updatedAt = new Date().toISOString();

            await window.apiClient.pendingApprovals.create({
              tableName: 'clients',
              parentRecordId: clientId,
              proposedData: proposed
            });
            requestedCount++;
          } catch (e) {
            lastError = e;
            console.error('Failed to submit client archive request', clientId, e);
          }
        }

        if (requestedCount === 0 && lastError) {
          Workflow.showMessage('Archive Request Failed', lastError.message || 'Unable to submit archive requests.', 'error');
        } else if (requestedCount === 0) {
          Workflow.showMessage('No new requests', 'Archive requests for the selected clients are already pending approval.', 'info');
        } else {
          Workflow.showMessage('Archive Requested', requestedCount === 1 ? 'Archive request submitted for Admin approval.' : `${requestedCount} archive requests submitted for Admin approval.`, 'success');
        }
        App.handleRoute();
      },
      'warning'
    );
  },

  async unarchiveClient(id) {
    await ClientsData.ensure();
    const restoreGeneration = this._startOptimisticSkip();
    const client = ClientsData.getClientById(id);
    const originalStatus = client ? client.status : null;
    if (client) client.status = 'Active';
    App.handleRoute();
    try {
      await window.apiClient.clients.unarchive(id);
      window.apiClient.clientCache.invalidate();
      ClientsData.invalidate();
      this._clearOptimisticSkipIfCurrent(restoreGeneration);
      await App.handleRoute();
    } catch (e) {
      if (client && originalStatus !== null) client.status = originalStatus;
      this._clearOptimisticSkipIfCurrent(restoreGeneration);
      await App.handleRoute();
      Workflow.showMessage('Error', e.message || 'Unable to restore client.', 'error');
    }
  },

  async bulkUnarchiveClients(clientIds) {
    if (!clientIds || clientIds.length === 0) return;
    const label = clientIds.length === 1 ? 'this client' : `these ${clientIds.length} clients`;
    Workflow.showConfirm('Restore Clients',
      `Are you sure you want to restore ${label} to Active Clients?`,
      async () => {
        await ClientsData.ensure();
        const restoreGeneration = this._startOptimisticSkip();
        const originals = [];
        clientIds.forEach(id => {
          const client = ClientsData.getClientById(id);
          if (client) {
            originals.push({ id, status: client.status });
            client.status = 'Active';
          }
        });
        App.handleRoute();

        let failedCount = 0;
        let lastError = null;
        for (const id of clientIds) {
          try {
            await window.apiClient.clients.unarchive(id);
          } catch (e) {
            failedCount++;
            lastError = e;
            const client = ClientsData.getClientById(id);
            const original = originals.find(o => o.id === id);
            if (client && original) client.status = original.status;
          }
        }

        window.apiClient.clientCache.invalidate();
        ClientsData.invalidate();
        this._clearOptimisticSkipIfCurrent(restoreGeneration);
        await App.handleRoute();
        if (failedCount > 0) {
          Workflow.showMessage('Error', lastError?.message || `Unable to restore ${failedCount} client(s).`, 'error');
        } else {
          Workflow.showMessage('Restored', `${clientIds.length} client(s) restored to Active Clients.`, 'success');
        }
      },
      'success'
    );
  },

  async getArchivedClients(query) {
    const res = await window.apiClient.clients.list(query ? { search: query, status: 'Archived' } : { status: 'Archived' });
    let clients = (res.data || []).map(c => this.normalizeClient(c));
    const entity = Auth.activeEntity;
    clients = clients.filter(c => {
      const cEnt = (c.entity || '').toUpperCase();
      return (entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(cEnt) : cEnt === entity.toUpperCase());
    });
    return clients;
  },

  async renderArchive(query = '') {
    const entity = Auth.activeEntity;
    const self = this;
    const isManagerial = Auth.isManagerial();
    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure()
    ]);

    const entFilter = ent => {
      const uEnt = (ent || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(uEnt);
      return uEnt === entity.toUpperCase();
    };

    let archived = await this.getArchivedClients(query);

    let rejectedClientChanges = [];
    let rejectedClientRequests = [];
    try {
      const [pendingRes, opRes] = await Promise.all([
        window.apiClient.admin.listPendingApprovals({ status: 'rejected', tableName: 'clients' }),
        window.apiClient.operationsRequests.list({ type: 'client', status: 'rejected' })
      ]);
      rejectedClientChanges = (pendingRes.data || []).filter(pc => {
        const data = pc.proposedData || {};
        if (!entFilter(data.entity)) return false;
        if (!isManagerial && pc.submittedBy !== Auth.user.id) return false;
        return true;
      });
      rejectedClientRequests = (opRes.data || []).filter(r => {
        if (!entFilter(r.entity)) return false;
        if (!isManagerial && r.requestedBy !== Auth.user.id) return false;
        return true;
      });
    } catch (e) {
      console.error('Failed to load rejected client records', e);
    }

    const canEdit = Auth.can('clients:edit');

    const buildItem = (c, category) => {
      const pocUser = window.apiClient.userCache.getById(c.contactUserId);
      return {
        id: c.id,
        category,
        title: c.name || '(untitled)',
        description: `TIN: ${c.tin || '—'}`,
        meta: [
          { icon: ArchivePage.icons.client, text: pocUser?.name || c.contactPerson || '—' },
          { icon: ArchivePage.icons.status, text: c.tradeName || '—' },
          { icon: ArchivePage.icons.date, text: formatDate(c.updatedAt) }
        ],
        actions: [
          {
            label: 'View',
            icon: ArchivePage.icons.view,
            onClick: () => { location.hash = '#clients/form/' + c.id; }
          },
          ...(category === 'accomplished' && canEdit ? [{
            label: 'Restore',
            icon: ArchivePage.icons.restore,
            className: 'primary',
            onClick: () => self.unarchiveClient(c.id)
          }] : [])
        ]
      };
    };

    const buildRejectedItem = record => {
      const isOpReq = record.hasOwnProperty('requestedBy');
      const data = isOpReq ? record : (record.proposedData || {});
      const clientId = isOpReq ? record.clientId : data.id;
      const client = clientId ? window.apiClient.clientCache.getById(clientId) : null;
      const title = isOpReq
        ? `Client Request ${client ? '— ' + (client.name || '') : ''}`
        : `Client Change: ${data.name || '(untitled)'}`;
      const reason = data.rejectionReason || record.rejectionReason || 'Rejected';
      return {
        id: record.id,
        category: 'rejected',
        title,
        meta: [
          { icon: ArchivePage.icons.client, text: client ? (client.name || '—') : '—' },
          { icon: ArchivePage.icons.date, text: formatDate(record.reviewedAt || record.updatedAt || record.requestedAt) },
          { icon: ArchivePage.icons.status, text: `Reason: ${reason}` }
        ],
        actions: [
          ...(clientId ? [{
            label: 'View Client',
            icon: ArchivePage.icons.view,
            onClick: () => { location.hash = '#clients/form/' + clientId; }
          }] : [])
        ]
      };
    };

    return ArchivePage.render({
      module: 'clients',
      categoryLabels: { accomplished: 'Archived', cancelled: 'Cancelled', rejected: 'Rejected' },
      categories: {
        accomplished: archived.map(c => buildItem(c, 'accomplished')),
        cancelled: [],
        rejected: [
          ...rejectedClientChanges.map(buildRejectedItem),
          ...rejectedClientRequests.map(buildRejectedItem)
        ]
      },
      emptyText: 'Archive is empty.',
      bulkActions: (ids) => [
        {
          text: 'Restore Selected',
          className: 'btn btn-primary btn-sm',
          onClick: (selectedIds) => {
            this.bulkUnarchiveClients(selectedIds);
          }
        }
      ]
    });
  }
};
