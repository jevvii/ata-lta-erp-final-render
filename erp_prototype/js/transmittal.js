/**
 * Transmittal Module
 * Create, send, and acknowledge transmittal letters with itemized document lists.
 *
 * Backend transmittal responses are snake_case; normalizeTransmittal() maps them to camelCase.
 * Backend transmittal responses are snake_case, so a normalizeTransmittal()
 * helper maps them to the camelCase shape the UI expects.
 */

const Transmittal = {
  view: 'list',
  detailId: null,
  listViewMode: 'table',
  prefilledRequestId: null,
  prefilledWrId: null,
  prefilledClientId: null,

  // ============================================================
  // Entity-tagged lightweight cache (mirrors WorkflowData patterns)
  // ============================================================
  _items: null,
  _entity: null,
  _loadingPromise: null,
  _loadingEntity: null,
  _loadGeneration: 0,
  _skipNextListFetch: false,

  _getActiveEntity() {
    return (typeof Auth !== 'undefined' && Auth.activeEntity) || null;
  },

  _isEntityFresh() {
    return this._entity === this._getActiveEntity();
  },

  hasData() {
    return Array.isArray(this._items) && this._isEntityFresh();
  },

  hasCachedData(entity) {
    return Array.isArray(this._items) && this._isEntityFresh() && (!entity || this._entity === entity);
  },

  invalidateCache() {
    this._items = null;
    this._entity = null;
    this._loadingPromise = null;
    this._loadingEntity = null;
    this._loadGeneration++;
    this._skipNextListFetch = false;
  },

  async ensure() {
    if (this.hasCachedData()) return;
    const activeEntity = this._getActiveEntity();
    // Share an in-flight load for the same entity.
    if (this._loadingPromise && this._loadingEntity === activeEntity) return this._loadingPromise;
    // Start a new load tagged with a generation so stale loads cannot clobber it.
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
    const res = await window.apiClient.transmittals.list();
    const items = (res.data || []).map(t => this.normalizeTransmittal(t));
    // Discard stale results from a prior entity or invalidated generation.
    if (loadGen !== this._loadGeneration || this._getActiveEntity() !== entity) {
      return this._items || [];
    }
    this._items = items;
    this._entity = entity;
    return items;
  },

  /**
   * Apply a partial update to a cached transmittal and return the original
   * snapshot so callers can roll back on API failure.
   */
  _updateCachedItem(id, updates) {
    if (!this._items) return null;
    const idx = this._items.findIndex(t => t.id === id);
    if (idx === -1) return null;
    const original = { ...this._items[idx] };
    this._items = this._items.map((t, i) => i === idx ? { ...t, ...updates } : t);
    return original;
  },

  // ============================================================
  // Normalization helpers (backend snake_case -> UI camelCase)
  // ============================================================

  /**
   * Convert a backend transmittal row to the local camelCase shape.
   * @param {object} t
   * @param {string} [entityCodeHint] - optional 'ATA'/'LTA' when we already know the entity
   * @returns {object}
   */
  normalizeTransmittal(t, entityCodeHint) {
    if (!t) return t;
    const entity = entityCodeHint || t.entityCode || t.entity_code || t.entity || this._entityCodeFromId(t.entity_id) || Auth.activeEntity;
    return {
      ...t,
      id: t.id,
      trackingNumber: t.tracking_number || t.trackingNumber,
      entityId: t.entity_id || t.entityId,
      entity,
      clientId: t.client_id || t.clientId,
      workRequestId: t.work_request_id || t.workRequestId,
      status: t.status,
      notes: t.notes,
      recipientName: t.recipient_name || t.recipientName,
      recipientDetails: t.recipient_details || t.recipientDetails,
      createdBy: t.created_by || t.createdBy,
      updatedBy: t.updated_by || t.updatedBy,
      createdAt: t.created_at || t.createdAt,
      updatedAt: t.updated_at || t.updatedAt,
      sentAt: t.sent_at || t.sentAt,
      sentBy: t.sent_by || t.sentBy,
      acknowledgedAt: t.acknowledged_at || t.acknowledgedAt,
      acknowledgedBy: t.acknowledged_by || t.acknowledgedBy,
      archived: t.archived || false,
      receivedByName: t.received_by_name || t.receivedByName || '',
      boardOrder: t.board_order || t.boardOrder,
      pendingChangeId: t.pending_change_id || t.pendingChangeId,
      items: (t.items || []).map(i => this.normalizeTransmittalItem(i))
    };
  },

  normalizeTransmittalItem(i) {
    if (!i) return i;
    return {
      ...i,
      id: i.id,
      transmittalId: i.transmittal_id || i.transmittalId,
      description: i.description,
      documentType: i.document_type || i.documentType,
      quantity: typeof i.quantity === 'number' ? i.quantity : 1,
      sortOrder: typeof i.sort_order === 'number' ? i.sort_order : (i.sortOrder || 0)
    };
  },

  _entityCodeFromId(entityId) {
    if (!entityId) return null;
    // Backend returns entity_id as a UUID but does not expose an entity code map.
    // The active entity is known from the request path, so callers that loop over
    // entities pass an explicit entityCodeHint. This fallback covers single-entity views.
    return Auth.activeEntity !== 'ALL' ? Auth.activeEntity : null;
  },

  /**
   * Execute an API call while temporarily switching Auth.activeEntity.
   * Used to support the frontend 'ALL' consolidated view against a backend
   * that only accepts ATA/LTA in the X-Active-Entity header.
   */
  async _callWithEntity(entityCode, fn) {
    const original = Auth.activeEntity;
    Auth.activeEntity = entityCode;
    try {
      return await fn();
    } finally {
      Auth.activeEntity = original;
    }
  },

  /**
   * List transmittals for the active entity. Uses the entity-tagged cache after
   * the first load; falls back to a fresh API load when the cache is missing or
   * stale. The backend handles consolidated 'ALL' by returning rows for all
   * accessible entities; each row carries its entity_code.
   */
  async _listForActiveEntity() {
    await this.ensure();
    return this._items || [];
  },

  /**
   * Get a single transmittal by id, handling 'ALL' by trying each entity.
   */
  async _getByIdAcrossEntities(id) {
    if (Auth.activeEntity !== 'ALL') {
      const res = await window.apiClient.transmittals.get(id);
      return this.normalizeTransmittal(res.data);
    }
    const codes = (Auth.user?.entities || []).filter(c => c !== 'ALL');
    for (const code of codes) {
      try {
        const res = await this._callWithEntity(code, () => window.apiClient.transmittals.get(id));
        if (res.data) return this.normalizeTransmittal(res.data, code);
      } catch (e) {
        // not found in this entity; continue
      }
    }
    return null;
  },

  async render() {
    this.listViewMode = App.getPreferredViewMode('transmittals');
    const container = el('div', { class: 'page' });

    if (this.view === 'detail' && this.detailId) {
      const t = await this._getByIdAcrossEntities(this.detailId);
      const titleBar = el('div', { class: 'page-title-bar-v2' });
      const h1 = el('h1', { class: 'breadcrumb-h1' });
      const baseLink = el('a', { href: 'javascript:void(0)', class: 'breadcrumb-base', text: 'Transmittal' });
      baseLink.addEventListener('click', () => { location.hash = '#transmittal'; });
      h1.appendChild(baseLink);
      h1.appendChild(el('span', { class: 'breadcrumb-sep', text: ' / ' }));
      h1.appendChild(document.createTextNode(t?.trackingNumber || 'Detail'));
      titleBar.appendChild(h1);

      const actions = el('div', { class: 'title-bar-actions' });
      if (t) {
        if (Auth.can('transmittal:mark')) {
          if (t.status === 'Draft') {
            if (Auth.can('transmittal:edit')) {
              const editBtn = el('button', { class: 'btn btn-primary btn-sm', text: 'Edit', style: 'margin-right:8px;' });
              editBtn.addEventListener('click', () => { this.showForm(t.id); });
              actions.appendChild(editBtn);
            }
            const sendBtn = el('button', { class: 'btn btn-primary btn-sm', text: 'Mark as Sent', style: 'margin-right:8px;' });
            sendBtn.addEventListener('click', () => {
              Workflow.showConfirm('Confirm Sent', 'Are you sure you want to mark this transmittal as sent?', async () => {
                const now = new Date().toISOString();
                const original = this._updateCachedItem(t.id, {
                  status: 'Sent',
                  sentAt: now,
                  sentBy: Auth.user?.id,
                  updatedAt: now,
                  updatedBy: Auth.user?.id
                });
                this._skipNextListFetch = true;
                App.handleRoute();
                try {
                  await window.apiClient.transmittals.send(t.id);
                } catch (e) {
                  if (original) this._updateCachedItem(t.id, original);
                  this._skipNextListFetch = true;
                  App.handleRoute();
                  Workflow.showMessage('Send Failed', e.message || 'Unable to send transmittal.', 'error');
                }
              }, 'success');
            });
            actions.appendChild(sendBtn);
          } else if (t.status === 'Sent') {
            const ackBtn = el('button', { class: 'btn btn-success btn-sm', text: 'Acknowledge Receipt', style: 'margin-right:8px;' });
            ackBtn.addEventListener('click', () => {
              this.showAcknowledgeDialog(t.id);
            });
            actions.appendChild(ackBtn);
          }
        }

        const printBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Print Transmittal', style: 'margin-right:8px;' });
        printBtn.addEventListener('click', () => this.openPrintLetter(t));
        actions.appendChild(printBtn);
      }
      const backBtn = el('button', { class: 'btn btn-secondary btn-sm', text: '← Back to List' });
      backBtn.addEventListener('click', () => { location.hash = '#transmittal'; });
      actions.appendChild(backBtn);
      titleBar.appendChild(actions);
      container.appendChild(titleBar);
    } else if (this.view === 'form') {
      container.classList.add('transmittal-tab-page');
      if (!Auth.can('transmittal:create')) {
        this.view = 'list';
      } else {
        const isNew = !this.detailId;
        let existing = null;
        if (!isNew) {
          try {
            const res = await window.apiClient.transmittals.get(this.detailId);
            existing = this.normalizeTransmittal(res.data);
          } catch (e) {
            console.error('Failed to load transmittal for form', e);
          }
        }
        const fullPageRoute = isNew ? '#transmittal/form/new' : `#transmittal/form/${this.detailId}`;
        const viewSwitcher = buildFormViewSwitcher({
          currentMode: PaneMode.FULL_PAGE,
          viewContext: 'transmittal-form',
          onSidePeek: () => {
            const transmittalId = this.detailId;
            closeFormPanelAndRoute('#transmittal');
            this.showForm(transmittalId, PaneMode.SIDE_PEEK);
          },
          onCenterPeek: () => {
            const transmittalId = this.detailId;
            closeFormPanelAndRoute('#transmittal');
            this.showForm(transmittalId, PaneMode.CENTER_PEEK);
          },
          onNewTab: () => {
            window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
          }
        });
        container.appendChild(buildFormBreadcrumb({
          baseLabel: 'Transmittal',
          baseHash: '#transmittal',
          currentText: isNew ? 'New Transmittal' : (existing?.trackingNumber || 'Edit Transmittal'),
          viewSwitcher,
          actions: [
            { text: isNew ? 'Create Transmittal' : 'Save Changes', class: 'btn btn-primary btn-sm', type: 'submit', form: 'transmittal-form' },
            { text: 'Cancel', class: 'btn btn-secondary btn-sm', onClick: () => { location.hash = '#transmittal'; } }
          ]
        }));
      }
    } else if (this.view === 'list') {
      container.classList.add('transmittal-tab-page');
      const titleBar = el('div', { class: 'page-title-bar-v2' });
      titleBar.appendChild(el('h1', { text: 'Transmittal' }));
      container.appendChild(titleBar);
      container.appendChild(await this.renderTabNav());
    }

    if (this.view === 'list') container.appendChild(await this.renderList());
    else if (this.view === 'form') container.appendChild(await this.renderForm({ hideHeader: true }));
    else if (this.view === 'detail') container.appendChild(await this.renderDetail());
    else if (this.view === 'archive') {
      // Archive UI is hidden because the backend has no archive/unarchive endpoints.
      this.view = 'list';
      App.handleRoute();
      return container;
    }

    setTimeout(() => this.updateStickyOffsets(), 0);
    return container;
  },

  init() {
    this.updateStickyOffsets();
  },

  updateStickyOffsets() {
    App.updateStickyOffsets();
  },

  async renderTabNav() {
    const entity = Auth.activeEntity;
    const entFilter = ent => {
      const uEnt = (ent || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(uEnt);
      return uEnt === entity.toUpperCase();
    };

    let count = 0;
    let archiveCount = 0;
    // Derive counts from the cached items instead of calling the counts API on
    // every render. The rejected operations-request count is still fetched live
    // because it is not part of the transmittal cache.
    try {
      await this.ensure();
      const items = this._items || [];
      count = items.filter(t => entFilter(t.entity) && t.status !== 'Cancelled' && !(t.status === 'Acknowledged' && t.archived)).length;
      archiveCount = items.filter(t => entFilter(t.entity) && t.status === 'Acknowledged' && t.archived).length;
    } catch (e) {
      console.error('Failed to load transmittal counts from cache', e);
    }

    try {
      const opRes = await window.apiClient.operationsRequests.list({ type: 'transmittal', status: 'rejected' });
      const rejectedRequests = opRes.data || [];
      archiveCount += rejectedRequests.filter(r => {
        if (!entFilter(r.entity)) return false;
        if (!Auth.isManagerial() && r.requestedBy !== Auth.user.id) return false;
        return true;
      }).length;
    } catch (e) {
      console.error('Failed to load rejected transmittal requests', e);
    }

    // Archive tab is hidden: the backend has no archive/unarchive endpoints.
    const tabs = [
      { key: 'list', label: 'Transmittals', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', count: count }
    ];

    const tabNav = renderModuleTabNav(tabs, this.view, (key) => {
      this.view = key;
      App.handleRoute();
    });

    const canCreate = Auth.can('transmittal:create');
    const canRequest = Auth.can('transmittal:request');

    if (canCreate && canRequest) {
      const wrapper = el('div', { class: 'split-btn-group' });

      const primaryBtn = el('button', {
        class: 'btn btn-primary btn-sm split-btn-left'
      });
      primaryBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Transmittal';
      primaryBtn.addEventListener('click', () => {
        this.showForm();
      });
      wrapper.appendChild(primaryBtn);

      const toggleBtn = el('button', {
        class: 'btn btn-primary btn-sm split-btn-right'
      });
      toggleBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      wrapper.appendChild(toggleBtn);

      const menu = el('div', { class: 'dropdown-menu split-btn-menu hidden' });

      const requestItem = el('button', { class: 'dropdown-item' });
      requestItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Request Transmittal';
      requestItem.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.add('hidden');
        Transmittal.showRequestTransmittalModal();
      });

      menu.appendChild(requestItem);
      wrapper.appendChild(menu);

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('hidden');
      });

      tabNav.appendChild(wrapper);
    } else if (canCreate) {
      const addBtn = el('button', {
        class: 'btn btn-primary btn-sm',
        style: 'margin-left: 16px; display: inline-flex; align-items: center; gap: 6px;',
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Transmittal'
      });
      addBtn.addEventListener('click', () => {
        this.showForm();
      });
      tabNav.appendChild(addBtn);
    } else if (canRequest) {
      const reqBtn = el('button', {
        class: 'btn btn-primary btn-sm',
        style: 'margin-left: 16px; display: inline-flex; align-items: center; gap: 6px;'
      });
      reqBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Request Transmittal';
      reqBtn.addEventListener('click', () => { Transmittal.showRequestTransmittalModal(); });
      tabNav.appendChild(reqBtn);
    }

    return tabNav;
  },

  // ============================================================
  // Helpers
  // ============================================================
  statusBadge(status) {
    const role = Auth.user?.role;
    const label = this.getTransmittalDisplayStatus(status, role);
    const map = {
      'Draft': 'badge badge-ghost',
      'Sent': 'badge badge-info',
      'Acknowledged': 'badge badge-success'
    };
    return el('span', { class: map[status] || 'badge', text: label });
  },

  getTransmittalDisplayStatus(status, role) {
    return status;
  },

  getBoardColumns() {
    const departments = Auth.user?.departments || [];
    const isAdmin = Auth.user?.role === 'Admin';
    const isOperations = departments.includes('Operations');
    const isDocumentation = departments.includes('Documentation');
    const isManagement = departments.includes('Management');
    const canCreate = Auth.can('transmittal:create');
    const draftColor = '#94a3b8';
    const sentColor = '#3b82f6';
    const ackColor = '#10b981';

    const draftCol = {
      key: 'Draft',
      label: isOperations ? 'Requested' : 'Draft',
      targetStatus: 'Draft',
      statuses: ['Draft'],
      color: isOperations ? '#f59e0b' : draftColor,
      emptyState: { variant: 'compact', title: 'No transmittals', body: '' }
    };
    if (!isOperations && canCreate) {
      draftCol.addButton = { label: 'Add Transmittal', onClick: () => this.showForm() };
    }

    const sentCol = {
      key: 'Sent',
      label: 'Sent',
      targetStatus: 'Sent',
      statuses: ['Sent'],
      color: sentColor,
      emptyState: { variant: 'compact', title: 'No transmittals', body: '' }
    };

    const ackCol = {
      key: 'Acknowledged',
      label: 'Acknowledged',
      targetStatus: 'Acknowledged',
      statuses: ['Acknowledged'],
      color: ackColor,
      emptyState: { variant: 'compact', title: 'No transmittals', body: '' }
    };

    // Admin: same as now (Draft | Sent | Acknowledged)
    if (isAdmin) return [draftCol, sentCol, ackCol];

    // Documentation and Management: Draft | Sent | Acknowledged
    if (isDocumentation || isManagement) return [draftCol, sentCol, ackCol];

    // Operations: Requested | Sent | Acknowledged
    if (isOperations) return [draftCol, sentCol, ackCol];

    // Others (Accounting, HR, etc.): Sent | Acknowledged
    return [sentCol, ackCol];
  },

  generateTrackingNumber(entity) {
    return (typeof Utils !== 'undefined' && typeof Utils.generateTrackingNumber === 'function')
      ? Utils.generateTrackingNumber(entity)
      : Transmittal._legacyGenerateTrackingNumber(entity);
  },

  _legacyGenerateTrackingNumber(entity) {
    const year = new Date().getFullYear();
    const prefix = entity + '-TX-' + year + '-';
    // Prefix uniqueness is best-effort; the backend enforces uniqueness via DB unique index.
    const suffix = String(Math.floor(Math.random() * 900) + 100).padStart(3, '0');
    return prefix + suffix;
  },

  async getClientName(clientId) {
    if (!clientId) return '—';
    await window.apiClient.clientCache.ensure();
    const client = window.apiClient.clientCache.getById(clientId);
    return client?.name || '—';
  },

  async getUserName(userId) {
    if (!userId) return '—';
    await window.apiClient.userCache.ensure();
    const user = window.apiClient.userCache.getById(userId);
    return user?.name || '—';
  },

  getWorkRequestTitle(wrId) {
    const wr = window.apiClient.workRequestCache.getById(wrId);
    return wr?.title || '—';
  },

  // ============================================================
  // List View
  // ============================================================
  async renderList() {
    const self = this;
    const entity = Auth.activeEntity;

    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure()
    ]);

    const wrapper = el('div');
    const stickyContainer = el('div', { class: 'toolbar-sticky-container' });
    const filters = el('div', { class: 'filters-bar' });

    // Jira Filter Toolbar & Active Filters State
    const activeFilters = {
      workRequest: new Set(),
      client: new Set(),
      employee: new Set(),
      status: new Set(),
      date: new Set()
    };

    this.searchQuery = '';

    const savedFilters = App.restoreFilters('transmittals');
    if (savedFilters) {
      if (Array.isArray(savedFilters.workRequest)) savedFilters.workRequest.forEach(v => activeFilters.workRequest.add(v));
      else if (savedFilters.workRequest) activeFilters.workRequest.add(savedFilters.workRequest);
      if (Array.isArray(savedFilters.client)) savedFilters.client.forEach(v => activeFilters.client.add(v));
      else if (savedFilters.client) activeFilters.client.add(savedFilters.client);
      if (Array.isArray(savedFilters.employee)) savedFilters.employee.forEach(v => activeFilters.employee.add(v));
      else if (savedFilters.employee) activeFilters.employee.add(savedFilters.employee);
      if (Array.isArray(savedFilters.status)) savedFilters.status.forEach(v => activeFilters.status.add(v));
      else if (savedFilters.status) activeFilters.status.add(savedFilters.status);
      if (Array.isArray(savedFilters.date)) savedFilters.date.forEach(v => activeFilters.date.add(v));
    }

    const saveCurrentFilters = () => {
      App.saveFilters('transmittals', {
        workRequest: Array.from(activeFilters.workRequest),
        client: Array.from(activeFilters.client),
        employee: Array.from(activeFilters.employee),
        status: Array.from(activeFilters.status),
        date: Array.from(activeFilters.date)
      });
    };

    const getWorkRequestOptions = () => {
      const wrs = window.apiClient.workRequestCache._wrs || [];
      return wrs.filter(wr => {
        const wrEnt = (wr.entity || '').toUpperCase();
        return entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(wrEnt) : wrEnt === entity.toUpperCase();
      }).map(wr => ({ value: wr.id, label: wr.title }));
    };

    const getClientOptions = () => {
      const allClients = window.apiClient.clientCache._clients || [];
      return allClients.filter(c => {
        const clientEnt = (c.entity || '').toUpperCase();
        return entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(clientEnt) : clientEnt === entity.toUpperCase();
      }).map(c => ({ value: c.id, label: c.name }));
    };

    const getEmployeeOptions = () => {
      const set = new Set();
      const staffUsers = window.apiClient.userCache._users || [];
      staffUsers.filter(u => {
        const userEnts = (u.entities || []).map(e => e.toUpperCase());
        return entity === 'ALL' ? userEnts.some(e => Auth.user.entities.map(ae => ae.toUpperCase()).includes(e)) : userEnts.includes(entity.toUpperCase());
      }).forEach(u => set.add(u.name));
      const wrs = window.apiClient.workRequestCache._wrs || [];
      wrs.forEach(wr => {
        (wr.tasks || []).forEach(t => {
          const name = (t.assigneeName || '').trim();
          if (name) set.add(name);
        });
      });
      return Array.from(set).map(n => ({ value: n, label: n }));
    };

    const getStatusOptions = () => [
      { value: 'Draft', label: 'Draft' },
      { value: 'Sent', label: 'Sent' },
      { value: 'Acknowledged', label: 'Acknowledged' }
    ];

    const getDueDateOptions = () => [
      { value: 'Overdue', label: 'Overdue' },
      { value: 'Due Today', label: 'Due Today' },
      { value: 'Due This Week', label: 'Due This Week' },
      { value: 'Due This Month', label: 'Due This Month' },
      { value: 'Due Later', label: 'Due Later' }
    ];

    const categories = {
      workRequest: { label: 'Work Request', getOptions: getWorkRequestOptions },
      client: { label: 'Client', getOptions: getClientOptions },
      employee: { label: 'Employee', getOptions: getEmployeeOptions },
      status: { label: 'Status', getOptions: getStatusOptions },
      date: { label: 'Date', hasDatePicker: true, getOptions: getDueDateOptions }
    };

    let groupBy = App.restoreGroupBy('transmittals') || 'none';
    const groupOptions = [
      { key: 'none', label: 'None' },
      { key: 'client', label: 'Client', getName: t => self.getClientName(t.clientId) },
      { key: 'employee', label: 'Employee', getName: async t => {
        const creatorName = await self.getUserName(t.createdBy);
        const senderName = await self.getUserName(t.sentBy);
        return creatorName || senderName || 'Unassigned';
      }},
      { key: 'workRequest', label: 'Work Request', getName: t => self.getWorkRequestTitle(t.workRequestId) }
    ];

    const toolbarContainer = createJiraFilterToolbar({
      moduleName: 'transmittals',
      searchConfig: {
        placeholder: 'Search transmittal...',
        onSearch: (q) => { this.searchQuery = q; updateFilters(); }
      },
      categories,
      activeFilters,
      onFilterChange: () => {
        saveCurrentFilters();
        updateFilters();
      },
      viewMode: this.listViewMode || 'table',
      onViewModeChange: (newMode) => {
        this.listViewMode = newMode;
        App.setPreferredViewMode('transmittals', newMode);
        saveCurrentFilters();
        updateFilters();
      },
      groupByOptions: groupOptions,
      currentGroupBy: groupBy,
      onGroupByChange: (newGroupBy) => {
        groupBy = newGroupBy;
        App.saveGroupBy('transmittals', groupBy);
        updateFilters();
      }
    });

    stickyContainer.appendChild(toolbarContainer);
    wrapper.appendChild(stickyContainer);

    const listContainer = el('div');
    wrapper.appendChild(listContainer);

    const updateFilters = async () => {
      try {
        let items;
        if (this._skipNextListFetch) {
          this._skipNextListFetch = false;
          items = (this._items || []).slice();
        } else {
          items = await this._listForActiveEntity();
        }
        this.refreshList(listContainer, items, activeFilters, this.listViewMode || 'table', groupBy, groupOptions, stickyContainer);
      } catch (e) {
        console.error('Failed to refresh transmittal list', e);
        listContainer.appendChild(renderEmptyState('Unable to load transmittals', e.message, { variant: 'zero-state' }));
      }
    };
    await updateFilters();

    return wrapper;
  },

  refreshList(container, items, activeFilters, viewMode, groupBy = 'none', groupOptions = [], toolbarContainer = null) {
    container.replaceChildren();

    items = items.filter(t => t.status !== 'Cancelled' && !(t.status === 'Acknowledged' && t.archived));
    const hasItems = items.length > 0;

    if (activeFilters.workRequest && activeFilters.workRequest.size > 0) {
      items = items.filter(t => activeFilters.workRequest.has(t.workRequestId));
    }
    if (activeFilters.client && activeFilters.client.size > 0) {
      items = items.filter(t => activeFilters.client.has(t.clientId));
    }
    if (activeFilters.employee && activeFilters.employee.size > 0) {
      items = items.filter(t => {
        const creatorName = this._nameForFilter(t.createdBy);
        const senderName = this._nameForFilter(t.sentBy);
        const acknowledgerName = this._nameForFilter(t.acknowledgedBy);
        return activeFilters.employee.has(creatorName) ||
               activeFilters.employee.has(senderName) ||
               activeFilters.employee.has(acknowledgerName);
      });
    }
    if (activeFilters.status && activeFilters.status.size > 0) {
      items = items.filter(t => activeFilters.status.has(t.status));
    }
    if (activeFilters.date && activeFilters.date.size > 0) {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const endOfWeek = new Date(now);
      endOfWeek.setDate(now.getDate() + (now.getDay() === 0 ? 0 : 7 - now.getDay()));
      const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const endOfMonthStr = endOfMonth.toISOString().slice(0, 10);

      items = items.filter(t => {
        const dStr = (t.transmittalDate || t.sentAt || t.createdAt || '').slice(0, 10);
        if (!dStr) return false;
        if (activeFilters.date.has(`DATE:${dStr}`)) return true;
        let bucket = 'Due Later';
        if (dStr < todayStr) bucket = 'Overdue';
        else if (dStr === todayStr) bucket = 'Due Today';
        else if (dStr <= endOfWeekStr) bucket = 'Due This Week';
        else if (dStr <= endOfMonthStr) bucket = 'Due This Month';
        return activeFilters.date.has(bucket);
      });
    }

    // Text search filter
    if (this.searchQuery) {
      items = items.filter(t => {
        const hay = [
          t.trackingNumber || '',
          t.title || t.subject || '',
          this.getClientName(t.clientId),
          t.status || '',
        ].join(' ').toLowerCase();
        return hay.includes(this.searchQuery);
      });
    }

    items.sort((a, b) => {
      const da = a.sentAt || a.createdAt || '';
      const db = b.sentAt || b.createdAt || '';
      return new Date(db) - new Date(da);
    });

    const hasActiveFilters = Object.values(activeFilters).some(s => s && s.size > 0);

    if (items.length === 0) {
      if (hasActiveFilters && hasItems) {
        container.appendChild(renderFilterEmptyState(
          'No transmittals match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('transmittals'); App.handleRoute(); } }]
        ));
      } else {
        container.appendChild(renderEmptyState('No transmittals found', null, { variant: 'zero-state' }));
      }
      return;
    }

    if (this.listViewMode === 'table') {
      this.renderTableView(container, items);
    } else if (this.listViewMode === 'board') {
      this.renderBoardView(container, items, groupBy, groupOptions, toolbarContainer);
    } else {
      this.renderCompactListView(container, items);
    }
  },

  _nameForFilter(userId) {
    if (!userId) return '';
    const user = window.apiClient.userCache.getById(userId);
    return user?.name || '';
  },

  renderTableView(container, items) {
    const self = this;
    const buildActions = (t) => {
      const wrapper = el('div', { style: 'display: inline-flex; gap: 4px; align-items: center;' });
      if (this.canEditTransmittal(t)) {
        const editBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Edit', style: 'margin-left:4px;' });
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showForm(t.id); });
        wrapper.appendChild(editBtn);
      }
      return wrapper;
    };

    const columns = [
      {
        key: 'trackingNumber',
        label: 'Tracking #',
        width: '30%',
        render: (t) => {
          const cell = el('div', { class: 'dt-title-cell' });
          cell.appendChild(el('span', { class: 'dt-title-link', text: t.trackingNumber || '—' }));
          return cell;
        }
      },
      { key: 'workRequestId', label: 'Work Request', render: (t) => this.getWorkRequestTitle(t.workRequestId) },
      { key: 'clientId', label: 'Client', render: (t) => this.getClientName(t.clientId) },
      { key: 'status', label: 'Status', render: (t) => this.statusBadge(t.status), width: '130px' },
      { key: 'items', label: 'Items', render: (t) => String((t.items || []).length), width: '70px', align: 'center' },
      { key: 'actions', label: 'Actions', render: (t) => buildActions(t), class: 'dt-actions-col', width: '180px' }
    ];

    const tableView = DataTable.render({
      items,
      columns,
      selectable: true,
      bulkActions: (ids) => {
        return [];
      },
      rowId: (t) => t.id,
      onRowClick: (t) => { location.hash = '#transmittal/detail/' + t.id; }
    });

    container.appendChild(tableView);
  },

  renderBoardView(container, items, groupBy = 'none', groupOptions = [], toolbarContainer = null) {
    toolbarContainer?.classList.remove('grouped-board-active');
    if (items.length === 0) {
      container.appendChild(renderEmptyStateV2({
        variant: 'zero-state',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        title: 'No transmittals found',
        body: 'Create a transmittal to start tracking document delivery.'
      }));
      return;
    }

    const canCreate = Auth.can('transmittal:create');
    const canEdit = Auth.can('transmittal:edit');
    const canMark = Auth.can('transmittal:mark');
    const self = this;

    const boardPhases = self.getBoardColumns();
    const statusColors = {
      'Draft': '#94a3b8',
      'Sent': '#3b82f6',
      'Acknowledged': '#10b981'
    };

    const sortedItems = [];
    boardPhases.forEach(phase => {
      const colItems = items.filter(t => phase.statuses.includes(t.status) && !t.pendingChangeId);
      colItems.sort((a, b) => {
        const oa = typeof a.boardOrder === 'number' ? a.boardOrder : null;
        const ob = typeof b.boardOrder === 'number' ? b.boardOrder : null;
        if (oa !== null && ob !== null) return oa - ob;
        if (oa !== null) return -1;
        if (ob !== null) return 1;
        return new Date(a.createdAt || a.sentAt || 0) - new Date(b.createdAt || b.sentAt || 0);
      });
      const colPendingItems = items.filter(t => phase.statuses.includes(t.status) && t.pendingChangeId);
      sortedItems.push(...colItems, ...colPendingItems);
    });

    const makeColumns = () => boardPhases.map(phase => ({
      key: phase.key,
      label: phase.label,
      targetStatus: phase.targetStatus,
      color: phase.color,
      addButton: phase.addButton,
      emptyState: { variant: 'compact', title: 'No transmittals', body: '' }
    }));

    const sortedForSeq = [...items].sort((a, b) => sortByDate(a, b, 'createdAt'));
    const seqMap = new Map(sortedForSeq.map((t, i) => [t.id, i + 1]));

    const renderCard = (t) => {
      const clientName = self.getClientName(t.clientId);
      const itemCount = (t.items || []).length;
      const date = t.sentAt || t.createdAt;

      const displayStatus = self.getTransmittalDisplayStatus(t.status, Auth.user?.role);
      const statusPriorityClass = {
        'Draft': 'card-v2-priority-normal',
        'Sent': 'card-v2-priority-medium',
        'Acknowledged': 'card-v2-priority-low'
      }[t.status] || 'card-v2-priority-normal';

      const progressMap = { 'Draft': 0, 'Sent': 50, 'Acknowledged': 100 };
      const progress = progressMap[t.status] || 0;

      const wr = window.apiClient.workRequestCache.getById(t.workRequestId);
      const detail = wr ? wr.title : '';

      return buildCompactBoardCard({
        key: 'TX-' + (seqMap.get(t.id) || 1),
        progress,
        statusColor: statusColors[t.status] || '#cbd5e1',
        title: t.trackingNumber,
        description: clientName,
        detail: `${itemCount} item${itemCount === 1 ? '' : 's'}` + (detail ? ` • ${detail}` : ''),
        date: date ? formatDate(date) : '',
        priority: displayStatus,
        priorityClass: statusPriorityClass,
        onClick: () => { location.hash = '#transmittal/detail/' + t.id; }
      });
    };

    const cardMenuItems = (t) => {
      const menu = [{
        label: 'View Details',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        onClick: () => { location.hash = '#transmittal/detail/' + t.id; }
      }];
      if (self.canEditTransmittal(t)) {
        menu.push({
          label: 'Edit',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
          onClick: () => self.showForm(t.id)
        });
      }
      if (canMark && t.status === 'Draft' && !t.pendingChangeId) {
        menu.push({
          label: 'Mark as Sent',
          className: 'primary',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
          onClick: () => Workflow.showConfirm(
            'Confirm Sent',
            'Are you sure you want to mark this transmittal as sent?',
            async () => {
              const now = new Date().toISOString();
              const original = self._updateCachedItem(t.id, {
                status: 'Sent',
                sentAt: now,
                sentBy: Auth.user?.id,
                updatedAt: now,
                updatedBy: Auth.user?.id
              });
              self._skipNextListFetch = true;
              App.handleRoute();
              try {
                await window.apiClient.transmittals.send(t.id);
              } catch (e) {
                if (original) self._updateCachedItem(t.id, original);
                self._skipNextListFetch = true;
                App.handleRoute();
                Workflow.showMessage('Send Failed', e.message || 'Unable to send transmittal.', 'error');
              }
            },
            'success'
          )
        });
      }
      if (canMark && t.status === 'Sent') {
        menu.push({
          label: 'Acknowledge Receipt',
          className: 'primary',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
          onClick: () => self.showAcknowledgeDialog(t.id)
        });
      }
      return menu;
    };

    // Backend has no boardOrder column, so drag-and-drop ordering cannot persist.
    // Drag is disabled to avoid a UI change that looks saved but is lost on refresh.
    const boardDrag = { enabled: false };

    if (groupBy !== 'none') {
      toolbarContainer?.classList.add('grouped-board-active');
      renderGroupedKanbanBoard({
        container,
        items: sortedItems,
        columns: makeColumns(),
        toolbarContainer,
        groupBy,
        groupOptions,
        renderCard,
        cardMenuItems,
        storageKey: 'erp_transmittals_grouped_collapsed',
        drag: boardDrag
      });
      return;
    }

    KanbanBoard.render({
      container,
      items: sortedItems,
      columns: makeColumns(),
      renderCard,
      cardMenuItems,
      drag: boardDrag
    });
  },

  renderCompactListView(container, items) {
    const list = el('div', { class: 'list-view' });
    items.forEach(t => {
      const item = el('div', { class: 'list-item', style: 'cursor: pointer;' });
      item.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input, select')) return;
        location.hash = '#transmittal/detail/' + t.id;
      });
      const left = el('div');
      left.appendChild(el('div', { class: 'list-item-title', text: t.trackingNumber }));
      left.appendChild(el('div', { class: 'list-item-meta', text: this.getClientName(t.clientId) + ' • ' + this.getWorkRequestTitle(t.workRequestId) + ' • ' + String((t.items || []).length) + ' items' }));
      item.appendChild(left);
      const actionWrap = el('div', { style: 'display:flex;gap:4px;align-items:center;flex-shrink:0;' });
      if (this.canEditTransmittal(t)) {
        const editBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Edit' });
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showForm(t.id); });
        actionWrap.appendChild(editBtn);
      }
      item.appendChild(actionWrap);
      list.appendChild(item);
    });
    container.appendChild(list);
  },

  canEditTransmittal(t) {
    return Auth.can('transmittal:edit') && t.status === 'Draft';
  },

  async showForm(txId = null, mode = null) {
    this.detailId = txId;
    const isNew = !txId;
    let existing = null;
    if (!isNew) {
      try {
        const res = await window.apiClient.transmittals.get(txId);
        existing = this.normalizeTransmittal(res.data);
      } catch (e) {
        console.error('Failed to load transmittal form', e);
      }
    }
    const fullPageRoute = isNew ? '#transmittal/form/new' : `#transmittal/form/${txId}`;

    openFormPanel({
      icon: '📨',
      title: isNew ? 'Create Transmittal' : `Edit Transmittal — ${existing?.trackingNumber || ''}`.trim(),
      formContent: await this.renderForm(),
      formId: 'transmittal-form',
      mode,
      viewContext: 'transmittal-form',
      fullPageRoute,
      newTabRoute: fullPageRoute,
      actions: [
        { text: isNew ? 'Create Transmittal' : 'Save Changes', class: 'btn btn-primary', type: 'submit', form: 'transmittal-form' },
        { text: 'Cancel', class: 'btn btn-secondary', onClick: () => closeFormPanelAndRoute('#transmittal') }
      ]
    });
  },

  // ============================================================
  // Create Form
  // ============================================================
  async renderForm(opts = {}) {
    const { hideHeader = false } = opts;
    const entity = Auth.activeEntity;
    const isNew = !this.detailId;
    let existing = null;
    if (this.detailId) {
      try {
        const res = await window.apiClient.transmittals.get(this.detailId);
        existing = this.normalizeTransmittal(res.data);
      } catch (e) {
        console.error('Failed to load transmittal form', e);
      }
    }

    await window.apiClient.clientCache.ensure();

    const container = el('div');

    if (!hideHeader) {
      const headerBar = el('div', { class: 'form-header-bar' });
      const headerActions = el('div', { class: 'form-actions-top' });
      const saveBtnTop = el('button', { type: 'submit', form: 'transmittal-form', class: 'btn btn-primary', text: isNew ? 'Create Transmittal' : 'Save Changes' });
      headerActions.appendChild(saveBtnTop);
      const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel' });
      cancelBtn.addEventListener('click', () => closeFormPanelAndRoute('#transmittal'));
      headerActions.appendChild(cancelBtn);
      headerBar.appendChild(headerActions);
      container.appendChild(headerBar);
    }

    const form = el('form', { id: 'transmittal-form', class: 'form-stacked notion-form' });

    // ── Top property grid ──
    const propsGrid = el('div', { class: 'notion-property-grid' });

    // Client
    const clientGroup = el('div', { class: 'notion-prop' });
    clientGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Client *' }));
    const clientSel = el('select', { name: 'clientId', required: true, class: 'notion-prop-select' });
    clientSel.appendChild(el('option', { value: '', text: '— Select —' }));
    const allClients = window.apiClient.clientCache._clients || [];
    allClients.filter(c => {
      const clientEnt = (c.entity || '').toUpperCase();
      return entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(clientEnt) : clientEnt === entity.toUpperCase();
    }).forEach(c => {
      const opt = el('option', { value: c.id, text: c.name });
      if (existing && existing.clientId === c.id) opt.selected = true;
      else if (!existing && this.prefilledClientId && this.prefilledClientId === c.id) opt.selected = true;
      clientSel.appendChild(opt);
    });
    clientGroup.appendChild(clientSel);
    propsGrid.appendChild(clientGroup);

    // Work Request (filtered by selected client)
    const wrGroup = el('div', { class: 'notion-prop' });
    wrGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg> Work Request *' }));
    const wrSel = el('select', { name: 'workRequestId', required: true, class: 'notion-prop-select' });
    wrSel.appendChild(el('option', { value: '', text: '— Select —' }));
    wrGroup.appendChild(wrSel);
    propsGrid.appendChild(wrGroup);

    // Tracking Number
    const tnGroup = el('div', { class: 'notion-prop' });
    tnGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h3M4 17v3h3M20 7V4h-3M20 17v3h-3M9 9h6v6H9z"/></svg> Tracking Number' }));
    const tnWrap = el('div', { class: 'notion-input-with-btn' });
    const tnInput = el('input', { type: 'text', name: 'trackingNumber', class: 'notion-prop-input', readonly: true, value: existing ? existing.trackingNumber : '' });
    tnInput.style.flex = '1';
    tnWrap.appendChild(tnInput);
    const genBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Generate' });
    genBtn.addEventListener('click', () => { tnInput.value = this.generateTrackingNumber(entity === 'ALL' ? (Auth.user.entities[0] || 'ATA') : entity); });
    tnWrap.appendChild(genBtn);
    tnGroup.appendChild(tnWrap);
    propsGrid.appendChild(tnGroup);

    form.appendChild(propsGrid);

    const populateWRs = (extraWrIds = new Set()) => {
      const selectedClientId = clientSel.value;
      const currentWR = wrSel.value;
      while (wrSel.firstChild) wrSel.removeChild(wrSel.firstChild);
      wrSel.appendChild(el('option', { value: '', text: '— Select —' }));
      let matchedCurrent = false;
      const allWrs = window.apiClient.workRequestCache._wrs || [];
      allWrs.filter(wr => {
        if (wr.entity !== entity) return false;
        return extraWrIds.has(wr.id) || !selectedClientId || wr.clientId === selectedClientId;
      }).forEach(wr => {
        const opt = el('option', { value: wr.id, text: wr.title });
        if (wr.id === currentWR) { opt.selected = true; matchedCurrent = true; }
        wrSel.appendChild(opt);
      });
      if (!matchedCurrent) wrSel.value = '';
    };

    clientSel.addEventListener('change', () => populateWRs());

    wrSel.addEventListener('change', () => {
      const wr = window.apiClient.workRequestCache.getById(wrSel.value);
      if (wr?.clientId && clientSel.value !== wr.clientId) {
        clientSel.value = wr.clientId;
        const extra = new Set(wr.id ? [wr.id] : []);
        populateWRs(extra);
        wrSel.value = wr.id;
      }
    });

    // Initial population
    const initialWRId = existing?.workRequestId || this.prefilledWrId || '';
    const initialClientId = existing?.clientId || this.prefilledClientId || '';
    if (initialClientId) clientSel.value = initialClientId;
    const initialExtra = new Set(initialWRId ? [initialWRId] : []);
    populateWRs(initialExtra);
    if (initialWRId) wrSel.value = initialWRId;

    // Itemized document list — Notion-style editable list
    form.appendChild(el('h3', { class: 'notion-section-heading', text: 'Transmittal Items' }));
    const itemsSection = el('div', { class: 'notion-line-items' });
    const itemsList = el('div', { class: 'notion-line-item-list', id: 'transmittal-items-list' });
    itemsSection.appendChild(itemsList);

    const addRowBtn = el('button', {
      type: 'button',
      class: 'notion-add-line-item',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add item'
    });
    addRowBtn.addEventListener('click', () => this.addItemRow(itemsList));
    itemsSection.appendChild(addRowBtn);
    form.appendChild(itemsSection);

    // Pre-populate rows for existing
    if (existing && existing.items && existing.items.length > 0) {
      existing.items.forEach(item => this.addItemRow(itemsList, item.description, item.documentType));
    } else {
      this.addItemRow(itemsList);
    }

    // Notes — Notion free-form section
    const notesSection = el('div', { class: 'notion-freeform' });
    notesSection.appendChild(el('label', { class: 'notion-section-label', text: 'Notes' }));
    const notesTextarea = el('textarea', { name: 'notes', class: 'notion-freeform-textarea', rows: 3, placeholder: 'Add any extra details...' });
    notesTextarea.textContent = existing ? (existing.notes || '') : '';
    notesSection.appendChild(notesTextarea);
    form.appendChild(notesSection);

    form.addEventListener('submit', (e) => { e.preventDefault(); this.submitForm(form); });

    container.appendChild(form);
    return container;
  },

  addItemRow(container, description = '', documentType = '') {
    const row = el('div', { class: 'notion-line-item-row' });

    const dragHandle = el('div', {
      class: 'notion-line-item-drag',
      title: 'Drag to reorder',
      html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>'
    });
    row.appendChild(dragHandle);

    const typeSel = el('select', { class: 'item-doc-type notion-line-item-type', required: true });
    typeSel.appendChild(el('option', { value: '', text: '— Type —' }));
    ['Original Scan', 'Generated Copy', 'Government Receipt', 'Final Deliverable', 'Other'].forEach(t => {
      const opt = el('option', { value: t, text: t });
      if (documentType === t) opt.selected = true;
      typeSel.appendChild(opt);
    });
    row.appendChild(typeSel);

    const descInput = el('input', { type: 'text', class: 'item-description notion-line-item-desc', required: true, value: description, placeholder: 'Description' });
    row.appendChild(descInput);

    const remBtn = el('button', {
      type: 'button',
      class: 'notion-line-item-remove',
      title: 'Remove',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    });
    remBtn.addEventListener('click', () => {
      if (container.querySelectorAll('.notion-line-item-row').length > 1) {
        row.remove();
      }
    });
    row.appendChild(remBtn);

    container.appendChild(row);
  },

  async submitForm(form) {
    if (!validateRequiredFields(form)) return;
    const isResubmitting = typeof PendingChanges !== 'undefined' && PendingChanges.editingPendingId;

    const entity = Auth.activeEntity;
    const data = Object.fromEntries(new FormData(form).entries());
    const isNew = !this.detailId;
    const itemsList = document.getElementById('transmittal-items-list');

    const items = [];
    itemsList.querySelectorAll('.notion-line-item-row').forEach(row => {
      const desc = row.querySelector('.item-description')?.value.trim();
      const type = row.querySelector('.item-doc-type')?.value;
      if (desc && type) {
        items.push({ description: desc, documentType: type });
      }
    });

    if (items.length === 0) {
      Workflow.showMessage('Item Error', 'Please add at least one item.', 'danger');
      return;
    }

    const payload = {
      workRequestId: data.workRequestId,
      clientId: data.clientId,
      trackingNumber: data.trackingNumber || this.generateTrackingNumber(entity === 'ALL' ? (Auth.user.entities[0] || 'ATA') : entity),
      items,
      notes: data.notes || null
    };

    let savedTransmittal = null;
    try {
      let res;
      if (isNew) {
        res = await window.apiClient.transmittals.create(payload);
      } else {
        res = await window.apiClient.transmittals.update(this.detailId, payload);
      }
      savedTransmittal = this.normalizeTransmittal(res?.data);
      // Update the local cache directly so the next list render is stable.
      if (savedTransmittal) {
        if (this._items) {
          if (isNew) {
            this._items = [savedTransmittal, ...this._items];
          } else {
            this._items = this._items.map(t => t.id === savedTransmittal.id ? savedTransmittal : t);
          }
        } else {
          this._items = [savedTransmittal];
          this._entity = this._getActiveEntity();
        }
      }
      if (typeof Dashboard !== 'undefined' && typeof Dashboard.invalidateCache === 'function') {
        Dashboard.invalidateCache();
      }
    } catch (e) {
      Workflow.showMessage(isNew ? 'Create Transmittal' : 'Update Transmittal', e.message || 'Unable to save transmittal.', 'error');
      return;
    }

    // Fulfill pending operations request if any.
    try {
      const reqId = this.prefilledRequestId || (payload.workRequestId
        ? (await window.apiClient.operationsRequests.list({ workRequestId: payload.workRequestId, type: 'transmittal', status: 'pending' })).data?.[0]?.id
        : null);
      if (reqId) {
        await window.apiClient.operationsRequests.update(reqId, {
          status: 'fulfilled',
          fulfilledBy: Auth.user.id,
          fulfilledAt: new Date().toISOString()
        });
      }
    } catch (e) {
      console.error('Failed to fulfill transmittal request', e);
    }
    this.prefilledRequestId = null;
    this.prefilledWrId = null;
    this.prefilledClientId = null;

    const msgConfig = {
      title: isNew ? 'Transmittal Created' : 'Transmittal Updated',
      message: 'Transmittal has been ' + (isNew ? 'created' : 'updated') + ' successfully.',
      type: 'success'
    };
    const targetRoute = isResubmitting ? '#admin' : '#transmittal';
    this._skipNextListFetch = true;
    closeFormPanelAndRoute(targetRoute, msgConfig);
  },

  // ============================================================
  // Detail View
  // ============================================================
  async showRequestTransmittalModal() {
    const entity = Auth.activeEntity;
    const wrs = (window.apiClient.workRequestCache._wrs || []).filter(wr => {
      const wrEnt = (wr.entity || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(wrEnt);
      return wrEnt === entity.toUpperCase();
    });

    const wrapper = el('div', { class: 'form-stacked', style: 'display: flex; flex-direction: column;' });
    const selectGroup = el('div', { class: 'form-group' });
    selectGroup.appendChild(el('label', { text: 'Select Work Request *' }));
    const wrSelect = el('select', { class: 'form-select', style: 'width:100%;' });
    wrSelect.appendChild(el('option', { value: '', text: '— Select —' }));
    for (const wr of wrs) {
      const clientName = this.getClientName(wr.clientId);
      try {
        const opRes = await window.apiClient.operationsRequests.list({ workRequestId: wr.id, type: 'transmittal', status: 'pending' });
        const pending = opRes.data || [];
        if (pending.length === 0) {
          wrSelect.appendChild(el('option', { value: wr.id, text: `${wr.title} — ${clientName}` }));
        }
      } catch (e) {
        console.error('Failed to check pending transmittal requests', e);
        wrSelect.appendChild(el('option', { value: wr.id, text: `${wr.title} — ${clientName}` }));
      }
    }
    selectGroup.appendChild(wrSelect);
    wrapper.appendChild(selectGroup);

    const notesGroup = el('div', { class: 'form-group' });
    notesGroup.appendChild(el('label', { text: 'Additional Notes (Optional)' }));
    notesGroup.appendChild(el('textarea', { id: 'trans-opreq-notes', class: 'form-control', style: 'width: 100%; min-height: 80px;', placeholder: 'Provide any details for Documentation staff...' }));
    wrapper.appendChild(notesGroup);

    wrapper.appendChild(el('div', { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;' }, [
      el('button', { id: 'btn-cancel-trans-opreq', class: 'btn btn-ghost', text: 'Cancel' }),
      el('button', { id: 'btn-save-trans-opreq', class: 'btn btn-primary', text: 'Submit Request' })
    ]));

    const overlay = Workflow.showModal('Request Transmittal', wrapper);

    overlay.querySelector('#btn-cancel-trans-opreq').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btn-save-trans-opreq').addEventListener('click', async () => {
      const wrId = wrSelect.value;
      if (!wrId) { alert('Please select a work request.'); return; }
      const wr = window.apiClient.workRequestCache.getById(wrId);
      const notes = overlay.querySelector('#trans-opreq-notes').value.trim();
      const record = {
        type: 'transmittal',
        workRequestId: wrId,
        clientId: wr?.clientId,
        requestedBy: Auth.user.id,
        status: 'pending',
        notes
      };
      try {
        await window.apiClient.operationsRequests.create(record);
      } catch (e) {
        Workflow.showMessage('Request Failed', e.message || 'Unable to submit transmittal request.', 'error');
        return;
      }
      overlay.remove();
      Workflow.showMessage('Request Submitted', 'Your transmittal request has been submitted to Documentation for review.', 'success');
      App.handleRoute();
    });
  },

  async renderDetail() {
    const t = await this._getByIdAcrossEntities(this.detailId);
    if (!t) { location.hash = '#transmittal'; return el('div'); }

    const container = el('div', { class: 'invoice-detail' });

    // Header
    const header = el('div', { class: 'invoice-header' });
    header.appendChild(el('h2', { text: 'Transmittal ' + t.trackingNumber }));
    header.appendChild(this.statusBadge(t.status));
    container.appendChild(header);

    // Meta
    const meta = el('div', { class: 'invoice-meta' });
    meta.appendChild(el('p', { text: 'Work Request: ' + this.getWorkRequestTitle(t.workRequestId) }));
    meta.appendChild(el('p', { text: 'Client: ' + await this.getClientName(t.clientId) }));
    if (t.sentAt) {
      const senderName = await this.getUserName(t.sentBy);
      meta.appendChild(el('p', { text: 'Sent: ' + formatDate(t.sentAt) + ' by ' + senderName }));
    }
    if (t.acknowledgedAt) {
      const ackByName = await this.getUserName(t.acknowledgedBy);
      const receivedPart = t.receivedByName ? ` (Received by: ${t.receivedByName})` : '';
      meta.appendChild(el('p', { text: 'Acknowledged: ' + formatDate(t.acknowledgedAt) + ' by ' + ackByName + receivedPart }));
    }
    if (t.notes) meta.appendChild(el('p', { text: 'Notes: ' + t.notes }));
    container.appendChild(meta);

    // Transmittal Letter Preview
    const letterSection = el('div', { class: 'form-section', style: 'margin-bottom: var(--spacing-lg);' });
    letterSection.appendChild(el('h3', { text: 'Transmittal' }));
    letterSection.appendChild(await this.buildLetterPreview(t));
    container.appendChild(letterSection);

    return container;
  },

  showAcknowledgeDialog(id) {
    const form = el('form', { class: 'form-stacked' });

    const nameGroup = el('div', { class: 'form-group' });
    nameGroup.appendChild(el('label', { text: 'Received By (Name) *' }));
    nameGroup.appendChild(el('input', { type: 'text', name: 'receivedBy', required: true, class: 'form-control' }));
    form.appendChild(nameGroup);

    const dateGroup = el('div', { class: 'form-group' });
    dateGroup.appendChild(el('label', { text: 'Received Date *' }));
    dateGroup.appendChild(el('input', { type: 'date', name: 'receivedDate', required: true, class: 'form-control', value: new Date().toISOString().slice(0, 10) }));
    form.appendChild(dateGroup);

    const submitBtn = el('button', { type: 'submit', class: 'btn btn-success', text: 'Confirm Acknowledgment', style: 'margin-top: 12px;' });
    form.appendChild(submitBtn);

    const overlay = Workflow.showModal('Acknowledge Transmittal Receipt', form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateRequiredFields(form)) return;
      const receivedByName = form.querySelector('[name="receivedBy"]')?.value.trim();
      const now = new Date().toISOString();
      const original = this._updateCachedItem(id, {
        status: 'Acknowledged',
        acknowledgedAt: now,
        acknowledgedBy: Auth.user?.id,
        receivedByName,
        updatedAt: now,
        updatedBy: Auth.user?.id
      });
      overlay.remove();
      this._skipNextListFetch = true;
      App.handleRoute();
      try {
        // Backend acknowledge endpoint does not persist receivedByName or a custom
        // receivedDate; it records the current server timestamp and current user.
        await window.apiClient.transmittals.acknowledge(id);
      } catch (err) {
        if (original) this._updateCachedItem(id, original);
        this._skipNextListFetch = true;
        App.handleRoute();
        Workflow.showMessage('Acknowledge Failed', err.message || 'Unable to acknowledge transmittal.', 'error');
      }
    });
  },

  async buildLetterPreview(t) {
    await window.apiClient.clientCache.ensure();
    const client = window.apiClient.clientCache.getById(t.clientId);
    const wr = window.apiClient.workRequestCache.getById(t.workRequestId);
    const entity = t.entity || 'ATA';
    const fromEntity = entity === 'ATA' ? 'ATA BUSINESS CONSULTANCY SERVICES' : 'LTA BUSINESS CONSULTANCY SERVICES';

    // Date formatting (Entity-aware)
    let formattedDate = '';
    const dateObj = new Date(t.sentAt || t.createdAt || new Date());
    if (entity === 'ATA') {
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      formattedDate = dateObj.toLocaleDateString('en-US', options).toUpperCase();
    } else {
      formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
    }

    // TO Field parsing
    await window.apiClient.userCache.ensure();
    const pocUser = window.apiClient.userCache.getById(client?.contactUserId);
    const pocName = pocUser?.name || client?.contactPerson || '';
    const clientName = client?.name || '';
    const tradeName = client?.tradeName || '';

    let toLine1 = pocName || clientName || '';
    let toLine2 = '';
    if (tradeName) {
      toLine2 = entity === 'ATA' ? `(${tradeName})` : tradeName;
    } else if (pocName && clientName) {
      toLine2 = entity === 'ATA' ? `(${clientName})` : clientName;
    }

    const address = client?.address || '';
    let toLine3 = '';
    let toLine4 = '';
    if (address) {
      const firstComma = address.indexOf(',');
      if (firstComma !== -1) {
        toLine3 = address.substring(0, firstComma).trim();
        toLine4 = address.substring(firstComma + 1).trim();
      } else {
        toLine3 = address;
      }
    }

    // Build the table rows for the documents
    const rows = [];
    const totalRows = 12;
    let usedRows = 0;

    (t.items || []).forEach(item => {
      if (usedRows < totalRows) {
        rows.push({ text: (item.documentType || '').toUpperCase(), isEmpty: false });
        usedRows++;
      }
      if (usedRows < totalRows) {
        rows.push({ text: (item.description || '').toUpperCase(), isEmpty: false });
        usedRows++;
      }
    });

    while (usedRows < totalRows) {
      rows.push({ text: '', isEmpty: true });
      usedRows++;
    }

    // Acknowledgment info for the signature
    let sigName = '';
    let sigDate = '';
    if (t.status === 'Acknowledged' && t.receivedByName) {
      sigName = t.receivedByName.toUpperCase();
      if (t.acknowledgedAt) {
        const dObj = new Date(t.acknowledgedAt);
        sigDate = `${dObj.getMonth() + 1}/${dObj.getDate()}/${String(dObj.getFullYear()).slice(-2)}`;
      }
    }

    const letter = el('div', { class: 'transmittal-letter', style: 'background:var(--color-surface); color:var(--color-text); font-family:Arial, sans-serif; padding:20px; border:1px solid var(--color-border); max-width:700px; margin:0 auto; box-sizing:border-box;' });

    // Styles local to the preview to ensure styling matches
    const styleEl = el('style', { textContent: `
      .preview-container {
        font-family: Arial, Helvetica, sans-serif;
      }
      .preview-header-table {
        width: 100%;
        border: 2px solid #000;
        border-collapse: collapse;
        margin-bottom: 15px;
      }
      .preview-header-table td {
        border: 2px solid #000;
        padding: 6px 10px;
        vertical-align: top;
      }
      .preview-title-cell {
        text-align: center;
        font-weight: bold;
        font-size: 12pt;
        letter-spacing: 0.5px;
        padding: 8px !important;
      }
      .preview-label-red {
        color: #c2272d;
        font-weight: bold;
        margin-right: 5px;
      }
      .preview-label-bold {
        font-weight: bold;
        margin-right: 5px;
      }
      .preview-underline-line {
        border-bottom: 1.5px solid #000;
        min-height: 16px;
        margin-top: 3px;
        padding-bottom: 1px;
        font-weight: bold;
      }
      .preview-document-box {
        border: 2px solid #000;
        position: relative;
        margin-bottom: 15px;
      }
      .preview-document-title {
        font-weight: bold;
        padding: 6px 10px;
        border-bottom: 2px solid #000;
        background-color: #fff;
        font-size: 10pt;
      }
      .preview-document-table {
        width: 100%;
        border-collapse: collapse;
      }
      .preview-doc-row {
        height: 22px;
      }
      .preview-doc-cell {
        border-bottom: 1px solid #000;
        text-align: center;
        font-weight: bold;
        padding: 2px 4px;
        font-size: 10pt;
      }
      .preview-document-table tr:last-child .preview-doc-cell {
        border-bottom: none;
      }
      .preview-received-stamp {
        position: absolute;
        right: 12%;
        top: 50%;
        transform: translateY(-50%) rotate(-7deg);
        border: 4px double #1e40af;
        color: #1e40af;
        padding: 6px 12px;
        text-align: center;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 12px;
        font-family: 'Courier New', Courier, monospace;
        font-weight: bold;
        pointer-events: none;
        z-index: 100;
      }
      .preview-stamp-title {
        font-size: 14pt;
        letter-spacing: 2px;
        border-bottom: 2px solid #1e40af;
        margin-bottom: 4px;
        padding-bottom: 1px;
      }
      .preview-stamp-date {
        font-size: 11pt;
      }
      .preview-signature-container {
        margin-top: 30px;
        width: 100%;
        max-width: 400px;
        margin-left: auto;
        margin-right: auto;
        text-align: center;
      }
      .preview-sig-info {
        display: flex;
        justify-content: space-between;
        padding: 0 20px;
        font-weight: bold;
        font-size: 11pt;
        min-height: 20px;
      }
      .preview-sig-name {
        flex: 2;
        text-align: center;
      }
      .preview-sig-date {
        flex: 1;
        text-align: right;
      }
      .preview-sig-line {
        border-top: 1.5px solid #000;
        margin-top: 2px;
      }
      .preview-sig-label {
        font-size: 9pt;
        color: #333;
        margin-top: 6px;
      }
    ` });
    letter.appendChild(styleEl);

    // Main layout container
    const previewContainer = el('div', { class: 'preview-container' });

    // Table Header Box
    const headerTable = el('table', { class: 'preview-header-table' });

    // Row 1: Title
    const r1 = el('tr');
    r1.appendChild(el('td', { colspan: '2', class: 'preview-title-cell', text: 'DOCUMENT TRANSMITTAL FORM' }));
    headerTable.appendChild(r1);

    // Row 2: Doc No & Date
    const r2 = el('tr');
    const tdDocNo = el('td', { style: 'width: 55%;' }, [
      el('span', { class: 'preview-label-red', text: 'TRANSMITTAL DOC NO.:' }),
      el('span', { class: 'value-bold', text: t.trackingNumber })
    ]);
    const tdDate = el('td', { style: 'width: 45%;' }, [
      el('span', { class: 'preview-label-bold', text: 'DATE:' }),
      el('span', { class: 'value-bold', text: formattedDate })
    ]);
    r2.appendChild(tdDocNo);
    r2.appendChild(tdDate);
    headerTable.appendChild(r2);

    // Row 3: FROM & TO
    const r3 = el('tr');
    const tdFrom = el('td', { style: 'width: 55%; line-height: 1.4;' }, [
      el('strong', { text: 'FROM:' }),
      document.createTextNode(' '),
      el('strong', { text: fromEntity }),
      el('br'),
      document.createTextNode('RM 307 Republic Supermarket Bldg,'),
      el('br'),
      document.createTextNode('Soler St., cor. F.Torres St.,'),
      el('br'),
      document.createTextNode('Sta. Cruz, Manila')
    ]);
    const tdTo = el('td', { style: 'width: 45%;' }, [
      el('div', { style: 'display: flex; gap: 8px; align-items: flex-start;' }, [
        el('strong', { text: 'TO:', style: 'margin-top: 3px;' }),
        el('div', { style: 'flex: 1; display: flex; flex-direction: column;' }, [
          el('div', { class: 'preview-underline-line', text: toLine1 }),
          el('div', { class: 'preview-underline-line', text: toLine2 }),
          el('div', { class: 'preview-underline-line', text: toLine3 }),
          el('div', { class: 'preview-underline-line', text: toLine4 })
        ])
      ])
    ]);
    r3.appendChild(tdFrom);
    r3.appendChild(tdTo);
    headerTable.appendChild(r3);

    previewContainer.appendChild(headerTable);

    // Document Box
    const docBox = el('div', { class: 'preview-document-box' });
    docBox.appendChild(el('div', { class: 'preview-document-title', text: 'Received the following documents and/or records:' }));

    const docTable = el('table', { class: 'preview-document-table' });
    rows.forEach(r => {
      const tr = el('tr', { class: 'preview-doc-row' });
      tr.appendChild(el('td', { class: 'preview-doc-cell', html: r.isEmpty ? '&nbsp;' : r.text }));
      docTable.appendChild(tr);
    });
    docBox.appendChild(docTable);

    // RECEIVED STAMP (if acknowledged)
    if (t.status === 'Acknowledged' && t.acknowledgedAt) {
      const stampDateObj = new Date(t.acknowledgedAt);
      const stampDateStr = stampDateObj.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

      const stamp = el('div', { class: 'preview-received-stamp' }, [
        el('div', { class: 'preview-stamp-title', text: 'RECEIVED' }),
        el('div', { class: 'preview-stamp-date', text: stampDateStr })
      ]);
      docBox.appendChild(stamp);
    }
    previewContainer.appendChild(docBox);

    // Notes (if any)
    if (t.notes) {
      previewContainer.appendChild(el('div', { style: 'margin: 10px 0; font-style: italic; font-size: 9.5pt; color: #555;', text: `Notes: ${t.notes}` }));
    }

    // Signature Box
    const sigContainer = el('div', { class: 'preview-signature-container' });
    sigContainer.appendChild(el('div', { class: 'preview-sig-info' }, [
      el('span', { class: 'preview-sig-name', text: sigName }),
      el('span', { class: 'preview-sig-date', text: sigDate })
    ]));
    sigContainer.appendChild(el('div', { class: 'preview-sig-line' }));
    sigContainer.appendChild(el('div', { class: 'preview-sig-label', text: 'Signature over Printed name / Date Received' }));
    previewContainer.appendChild(sigContainer);

    letter.appendChild(previewContainer);
    return letter;
  },

  async openPrintLetter(t) {
    const win = window.open('', '_blank');
    if (!win) return;

    await window.apiClient.clientCache.ensure();
    const client = window.apiClient.clientCache.getById(t.clientId);
    const wr = window.apiClient.workRequestCache.getById(t.workRequestId);
    const entity = t.entity || 'ATA';
    const fromEntity = entity === 'ATA' ? 'ATA BUSINESS CONSULTANCY SERVICES' : 'LTA BUSINESS CONSULTANCY SERVICES';

    // Date formatting (Entity-aware)
    let formattedDate = '';
    const dateObj = new Date(t.sentAt || t.createdAt || new Date());
    if (entity === 'ATA') {
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      formattedDate = dateObj.toLocaleDateString('en-US', options).toUpperCase();
    } else {
      formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;
    }

    // TO Field parsing
    await window.apiClient.userCache.ensure();
    const pocUser = window.apiClient.userCache.getById(client?.contactUserId);
    const pocName = pocUser?.name || client?.contactPerson || '';
    const clientName = client?.name || '';
    const tradeName = client?.tradeName || '';

    let toLine1 = pocName || clientName || '';
    let toLine2 = '';
    if (tradeName) {
      toLine2 = entity === 'ATA' ? `(${tradeName})` : tradeName;
    } else if (pocName && clientName) {
      toLine2 = entity === 'ATA' ? `(${clientName})` : clientName;
    }

    const address = client?.address || '';
    let toLine3 = '';
    let toLine4 = '';
    if (address) {
      const firstComma = address.indexOf(',');
      if (firstComma !== -1) {
        toLine3 = address.substring(0, firstComma).trim();
        toLine4 = address.substring(firstComma + 1).trim();
      } else {
        toLine3 = address;
      }
    }

    // Build the table rows for the documents
    const totalRows = 12;
    let usedRows = 0;
    let rowsHtml = '';

    (t.items || []).forEach(item => {
      if (usedRows < totalRows) {
        rowsHtml += `<tr class="doc-row"><td class="doc-cell">${(item.documentType || '').toUpperCase()}</td></tr>`;
        usedRows++;
      }
      if (usedRows < totalRows) {
        rowsHtml += `<tr class="doc-row"><td class="doc-cell">${(item.description || '').toUpperCase()}</td></tr>`;
        usedRows++;
      }
    });

    while (usedRows < totalRows) {
      rowsHtml += `<tr class="doc-row"><td class="doc-cell">&nbsp;</td></tr>`;
      usedRows++;
    }

    // RECEIVED STAMP (if acknowledged)
    let stampHtml = '';
    if (t.status === 'Acknowledged' && t.acknowledgedAt) {
      const stampDateObj = new Date(t.acknowledgedAt);
      const stampDateStr = stampDateObj.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
      stampHtml = `
        <div class="received-stamp">
          <div class="stamp-title">RECEIVED</div>
          <div class="stamp-date">${stampDateStr}</div>
        </div>
      `;
    }

    // Acknowledgment info for the signature
    let sigName = '';
    let sigDate = '';
    if (t.status === 'Acknowledged' && t.receivedByName) {
      sigName = t.receivedByName.toUpperCase();
      if (t.acknowledgedAt) {
        const dObj = new Date(t.acknowledgedAt);
        sigDate = `${dObj.getMonth() + 1}/${dObj.getDate()}/${String(dObj.getFullYear()).slice(-2)}`;
      }
    }

    const doc = win.document;
    const meta = doc.createElement('meta');
    meta.setAttribute('charset', 'UTF-8');
    doc.head.appendChild(meta);
    const title = doc.createElement('title');
    title.textContent = 'Transmittal — ' + t.trackingNumber;
    doc.head.appendChild(title);

    const style = doc.createElement('style');
    style.textContent = `
      @page {
        size: letter;
        margin: 12mm 15mm;
      }
      body {
        font-family: Arial, Helvetica, sans-serif;
        margin: 0;
        padding: 0;
        color: #000;
        background-color: #fff;
        font-size: 10pt;
        line-height: 1.35;
      }
      .container {
        width: 100%;
        max-width: 680px;
        margin: 0 auto;
        position: relative;
      }
      .header-table {
        width: 100%;
        border: 2px solid #000;
        border-collapse: collapse;
        margin-bottom: 15px;
      }
      .header-table td {
        border: 2px solid #000;
        padding: 6px 10px;
        vertical-align: top;
      }
      .title-cell {
        text-align: center;
        font-weight: bold;
        font-size: 12pt;
        letter-spacing: 0.5px;
        padding: 8px !important;
      }
      .doc-no-cell {
        width: 55%;
      }
      .date-cell {
        width: 45%;
      }
      .label-red {
        color: #c2272d;
        font-weight: bold;
        margin-right: 5px;
      }
      .label-bold {
        font-weight: bold;
        margin-right: 5px;
      }
      .value-bold {
        font-weight: bold;
      }
      .from-cell {
        width: 55%;
        line-height: 1.4;
      }
      .to-cell {
        width: 45%;
        line-height: 1.4;
      }
      .underline-line {
        border-bottom: 1.5px solid #000;
        min-height: 16px;
        margin-top: 3px;
        padding-bottom: 1px;
        font-weight: bold;
      }
      .document-box {
        border: 2px solid #000;
        position: relative;
        margin-bottom: 15px;
      }
      .document-title {
        font-weight: bold;
        padding: 6px 10px;
        border-bottom: 2px solid #000;
        background-color: #fff;
        font-size: 10pt;
      }
      .document-table {
        width: 100%;
        border-collapse: collapse;
      }
      .doc-row {
        height: 22px;
      }
      .doc-cell {
        border-bottom: 1px solid #000;
        text-align: center;
        font-weight: bold;
        padding: 2px 4px;
        font-size: 10pt;
      }
      .document-table tr:last-child .doc-cell {
        border-bottom: none;
      }
      .received-stamp {
        position: absolute;
        right: 12%;
        top: 50%;
        transform: translateY(-50%) rotate(-7deg);
        border: 4px double #1e40af;
        color: #1e40af;
        padding: 6px 12px;
        text-align: center;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 12px;
        font-family: 'Courier New', Courier, monospace;
        font-weight: bold;
        pointer-events: none;
        z-index: 100;
      }
      .stamp-title {
        font-size: 14pt;
        letter-spacing: 2px;
        border-bottom: 2px solid #1e40af;
        margin-bottom: 4px;
        padding-bottom: 1px;
      }
      .stamp-date {
        font-size: 11pt;
        letter-spacing: 1px;
      }
      .signature-container {
        margin-top: 30px;
        width: 100%;
        max-width: 400px;
        margin-left: auto;
        margin-right: auto;
        text-align: center;
      }
      .sig-info {
        display: flex;
        justify-content: space-between;
        padding: 0 20px;
        font-weight: bold;
        font-size: 11pt;
        min-height: 20px;
      }
      .sig-name {
        flex: 2;
        text-align: center;
      }
      .sig-date {
        flex: 1;
        text-align: right;
      }
      .sig-line {
        border-top: 1.5px solid #000;
        margin-top: 2px;
      }
      .sig-label {
        font-size: 9pt;
        color: #333;
        margin-top: 6px;
      }
    `;
    doc.head.appendChild(style);

    const body = doc.body;
    body.innerHTML = `
      <div class="container">
        <table class="header-table">
          <tr>
            <td colspan="2" class="title-cell">DOCUMENT TRANSMITTAL FORM</td>
          </tr>
          <tr>
            <td class="doc-no-cell">
              <span class="label-red">TRANSMITTAL DOC NO.:</span>
              <span class="value-bold">${t.trackingNumber}</span>
            </td>
            <td class="date-cell">
              <span class="label-bold">DATE:</span>
              <span class="value-bold">${formattedDate}</span>
            </td>
          </tr>
          <tr>
            <td class="from-cell">
              <strong>FROM:</strong> <strong>${fromEntity}</strong><br>
              RM 307 Republic Supermarket Bldg,<br>
              Soler St., cor. F.Torres St.,<br>
              Sta. Cruz, Manila
            </td>
            <td class="to-cell">
              <div style="display: flex; gap: 8px; align-items: flex-start;">
                <strong style="margin-top: 3px;">TO:</strong>
                <div style="flex: 1; display: flex; flex-direction: column;">
                  <div class="underline-line">${toLine1}</div>
                  <div class="underline-line">${toLine2}</div>
                  <div class="underline-line">${toLine3}</div>
                  <div class="underline-line">${toLine4}</div>
                </div>
              </div>
            </td>
          </tr>
        </table>

        <div class="document-box">
          <div class="document-title">Received the following documents and/or records:</div>
          <table class="document-table">
            ${rowsHtml}
          </table>
          ${stampHtml}
        </div>

        ${t.notes ? `<div style="margin: 10px 0; font-style: italic; font-size: 9.5pt; color: #555;">Notes: ${t.notes}</div>` : ''}

        <div class="signature-container">
          <div class="sig-info">
            <span class="sig-name">${sigName}</span>
            <span class="sig-date">${sigDate}</span>
          </div>
          <div class="sig-line"></div>
          <div class="sig-label">Signature over Printed name / Date Received</div>
        </div>
      </div>
    `;

    win.focus();
    setTimeout(() => win.print(), 300);
  },

  // Archive actions are hidden because the backend has no archive/unarchive
  // endpoints. These stubs remain as no-ops so any stale callers do nothing.
  archiveTransmittal(id) {},
  bulkArchiveTransmittals(ids) {},
  unarchiveTransmittal(id) {},

  permanentDeleteTransmittal(id) {
    if (Auth.user?.role !== 'Admin' && !Auth.isManagerial() && !Auth.can('transmittal:delete')) {
      Workflow.showMessage('Permission Denied', 'Only authorized users can permanently delete transmittals.', 'danger');
      return;
    }
    Workflow.showConfirm('Permanently Delete Transmittal',
      'Are you sure you want to permanently delete this transmittal? This action cannot be undone.',
      async () => {
        await this.ensure();
        const items = this._items || [];
        const index = items.findIndex(t => t.id === id);
        let removedItem = null;
        if (index !== -1) {
          removedItem = items[index];
          this._items = [...items.slice(0, index), ...items.slice(index + 1)];
        }
        this._skipNextListFetch = true;
        App.handleRoute();
        try {
          await window.apiClient.transmittals.remove(id);
          this.invalidateCache();
          if (typeof Dashboard !== 'undefined') {
            if (typeof Dashboard._dataCache !== 'undefined') Dashboard._dataCache = null;
            if (typeof Dashboard.invalidateCache === 'function') Dashboard.invalidateCache();
          }
          Workflow.showMessage('Deleted', 'Transmittal has been permanently deleted.', 'success');
        } catch (e) {
          if (removedItem) {
            const rollback = [...(this._items || [])];
            rollback.splice(index, 0, removedItem);
            this._items = rollback;
          }
          this._skipNextListFetch = true;
          App.handleRoute();
          Workflow.showMessage('Delete Failed', e.message || 'Unable to delete transmittal.', 'error');
        }
      },
      'danger'
    );
  },

  async renderArchive() {
    const entity = Auth.activeEntity;
    const self = this;
    const isManagerial = Auth.isManagerial();

    const entFilter = ent => {
      const uEnt = (ent || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(uEnt);
      return uEnt === entity.toUpperCase();
    };

    let all = [];
    try {
      all = await this._listForActiveEntity();
    } catch (e) {
      console.error('Failed to load archive transmittals', e);
    }

    const acknowledged = all.filter(t => entFilter(t.entity) && t.status === 'Acknowledged' && t.archived === true);
    const cancelled = [];

    let rejectedTransmittalRequests = [];
    try {
      const opRes = await window.apiClient.operationsRequests.list({ type: 'transmittal', status: 'rejected' });
      rejectedTransmittalRequests = (opRes.data || []).filter(r => {
        if (!entFilter(r.entity)) return false;
        if (!isManagerial && r.requestedBy !== Auth.user.id) return false;
        return true;
      });
    } catch (e) {
      console.error('Failed to load rejected transmittal requests', e);
    }

    const buildItem = (t, category) => {
      const wrTitle = this.getWorkRequestTitle(t.workRequestId);
      return {
        id: t.id,
        category,
        title: t.trackingNumber || '(no tracking)',
        meta: [
          { icon: ArchivePage.icons.client, text: this.getClientName(t.clientId) },
          { icon: ArchivePage.icons.status, text: wrTitle },
          { icon: ArchivePage.icons.date, text: formatDate(t.updatedAt) }
        ],
        actions: [
          {
            label: 'View',
            icon: ArchivePage.icons.view,
            onClick: () => { location.hash = '#transmittal/detail/' + t.id; }
          }
        ]
      };
    };

    const buildRejectedItem = r => {
      const data = r || {};
      const wrTitle = this.getWorkRequestTitle(r.workRequestId);
      return {
        id: r.id,
        category: 'rejected',
        title: `Transmittal Request ${wrTitle ? '— ' + wrTitle : ''}`,
        meta: [
          { icon: ArchivePage.icons.client, text: this.getClientName(r.clientId) },
          { icon: ArchivePage.icons.date, text: formatDate(r.reviewedAt || r.updatedAt || r.requestedAt) },
          { icon: ArchivePage.icons.status, text: `Reason: ${r.rejectionReason || 'Rejected'}` }
        ],
        actions: [
          ...(r.workRequestId ? [{
            label: 'View Related WR',
            icon: ArchivePage.icons.view,
            onClick: () => { location.hash = '#operations/detail/' + r.workRequestId; }
          }] : [])
        ]
      };
    };

    return ArchivePage.render({
      module: 'transmittal',
      categoryLabels: { accomplished: 'Acknowledged', cancelled: 'Cancelled', rejected: 'Rejected' },
      categories: {
        accomplished: acknowledged.map(t => buildItem(t, 'accomplished')),
        cancelled: cancelled.map(t => buildItem(t, 'cancelled')),
        rejected: rejectedTransmittalRequests.map(buildRejectedItem)
      },
      emptyText: 'Archive is empty.',
      renderCallback: () => self.renderArchive()
    });
  }
};
