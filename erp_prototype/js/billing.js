/**
 * Billing Module
 * Sales Invoice creation, payment tracking, aging.
 * VAT removed per v3 schema — total = subtotal.
 */

const Billing = {
  view: 'list', // 'list' | 'form' | 'detail' | 'aging' | 'templates' | 'templateForm'
  detailId: null,
  templateEditingId: null,
  currentListPage: 1,
  pendingPrefill: null, // { clientId, workRequestId } — set when generating billing from a WR
  _counts: null, // cached tab-badge counts from the backend
  _countsEntity: null, // entity the cached counts belong to
  _archivePage: 1,
  _archiveLimit: 20,
  _lastArchiveMeta: {},
  _detailCache: {}, // cached individual invoices for hot detail/form paths
  _detailCacheEntity: null, // entity the detail cache belongs to
  _listCache: [], // entity-tagged cache of all invoices (active + archived + cancelled)
  _listCacheEntity: null,
  _listCacheGeneration: 0, // incremented on invalidate to drop stale in-flight fetches
  _skipFetchGeneration: 0, // incremented on every optimistic mutation
  _activeSkipGeneration: 0, // generation currently honored by the list renderer
  _templates: [], // cached billing templates for the active entity
  _templatesPromise: null, // in-flight loadTemplates() promise
  _templatesEntity: null,
  _templatesGeneration: 0,
  _templatesBackgroundPromise: null, // in-flight template background refresh

  _entityMatches(invEntity, entity) {
    const u = (invEntity || '').toUpperCase();
    if (!u) return true;
    if (entity === 'ALL') {
      return Auth.user?.entities?.map(e => e.toUpperCase()).includes(u) || true;
    }
    return u === (entity || '').toUpperCase();
  },

  _isActiveInvoice(inv, entity) {
    const e = inv?.entity || inv?.entityCode || inv?.entity_code;
    return this._entityMatches(e, entity) &&
      inv?.status !== 'Cancelled' &&
      !inv?.archived;
  },

  _isArchiveInvoice(inv, entity) {
    const e = inv?.entity || inv?.entityCode || inv?.entity_code;
    return this._entityMatches(e, entity) &&
      (inv?.status === 'Cancelled' || inv?.archived);
  },

  _isListCacheFresh() {
    return this._listCacheEntity === Auth.activeEntity;
  },

  async ensure() {
    const skipping = this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration;
    if (skipping || this._isListCacheFresh()) return;
    const loadGen = ++this._listCacheGeneration;
    await this._loadInvoices(loadGen, { merge: false });
  },

  async _loadInvoices(loadGen, { merge = false } = {}) {
    const entity = Auth.activeEntity;
    try {
      const res = await window.apiClient.invoices.list({ limit: 10000 });
      if (loadGen !== this._listCacheGeneration || entity !== Auth.activeEntity) return;
      const invoices = (res.data || []).map(inv => this.normalizeInvoice(inv));
      invoices.forEach(inv => { this._detailCache[inv.id] = inv; });
      this._detailCacheEntity = entity;
      this._lastInvoiceMeta = res.meta || {};
      if (merge && Array.isArray(this._listCache) && this._listCacheEntity === entity) {
        const existingMap = new Map(this._listCache.map(inv => [inv.id, inv]));
        invoices.forEach(inv => {
          const existing = existingMap.get(inv.id);
          if (existing) Object.assign(existing, inv);
          else if (!this._isTempId(inv.id)) this._listCache.push(inv);
        });
      } else {
        this._listCache = invoices;
      }
      this._listCacheEntity = entity;
    } catch (e) {
      if (!isAbortError(e)) console.error('Failed to load invoices', e);
    }
  },

  async backgroundRefresh() {
    if (this._backgroundPromise) return this._backgroundPromise;
    const loadGen = ++this._listCacheGeneration;
    this._backgroundPromise = this._loadInvoices(loadGen, { merge: true }).finally(() => {
      if (this._listCacheGeneration === loadGen) this._backgroundPromise = null;
    });
    return this._backgroundPromise;
  },

  invalidateCache() {
    this._detailCache = {};
    this._detailCacheEntity = null;
    this._listCache = [];
    this._listCacheEntity = null;
    this._listCacheGeneration++;
    this._skipFetchGeneration = 0;
    this._activeSkipGeneration = 0;
    this._counts = null;
    this._countsEntity = null;
    this._templates = [];
    this._templatesEntity = null;
    this._templatesGeneration++;
    this._templatesPromise = null;
    this._templatesBackgroundPromise = null;
  },

  _beginSkipGeneration() {
    this._skipFetchGeneration = (this._skipFetchGeneration || 0) + 1;
    this._activeSkipGeneration = this._skipFetchGeneration;
    return this._skipFetchGeneration;
  },

  _endSkipGeneration(generation) {
    if (this._activeSkipGeneration === generation) {
      this._activeSkipGeneration = 0;
    }
  },

  hasCachedData(entity) {
    const activeEntity = entity || Auth.activeEntity;
    return !!activeEntity &&
      this._detailCacheEntity === activeEntity &&
      this._listCacheEntity === activeEntity &&
      this._countsEntity === activeEntity &&
      Array.isArray(this._listCache) &&
      this._counts !== null;
  },

  getInvoiceById(id) {
    if (!id) return null;
    if (this._detailCacheEntity !== Auth.activeEntity) return null;
    return this._detailCache[id] ? deepClone(this._detailCache[id]) : null;
  },

  _snapshotInvoice(id) {
    const inv = this._detailCache[id];
    return inv ? deepClone(inv) : null;
  },

  _rollbackInvoice(id, snapshot) {
    if (snapshot) {
      this._detailCache[id] = snapshot;
    } else {
      delete this._detailCache[id];
    }
  },

  _addToListCache(inv, { prepend = false } = {}) {
    if (!inv) return;
    const entity = Auth.activeEntity;
    // If the list cache has not been loaded yet, initialize it from this record
    // so optimistic inserts are visible immediately.
    if (!Array.isArray(this._listCache)) {
      this._listCache = [];
      this._listCacheEntity = entity;
      this._listCacheGeneration = (this._listCacheGeneration || 0) + 1;
    }
    if (!this._entityMatches(inv?.entity, entity)) return;
    const idx = this._listCache.findIndex(i => i.id === inv.id);
    if (idx >= 0) {
      this._listCache[idx] = inv;
    } else if (prepend) {
      this._listCache.unshift(inv);
    } else {
      this._listCache.push(inv);
    }
  },

  _removeFromListCache(id) {
    if (!id || !Array.isArray(this._listCache)) return;
    this._listCache = this._listCache.filter(inv => inv.id !== id);
  },

  _replaceInListCache(tempId, record) {
    if (!tempId || !record) return;
    if (!Array.isArray(this._listCache)) {
      this._listCache = [record];
      this._listCacheEntity = Auth.activeEntity;
      return;
    }
    // Avoid duplicates if a background fetch already returned the server record.
    this._listCache = this._listCache.filter(i => i.id !== record.id);
    const idx = this._listCache.findIndex(i => i.id === tempId);
    if (idx >= 0) {
      this._listCache[idx] = record;
    } else {
      this._listCache.unshift(record);
    }
  },

  _isTempId(id) {
    return typeof id === 'string' && id.startsWith('temp-');
  },

  _invalidateRelatedCaches(record) {
    // Update the linked work request in the shared cache instead of invalidating it,
    // so that work-request dropdowns in other forms do not become empty.
    if (record?.workRequestId) {
      if (window.apiClient?.workRequestCache?.getById) {
        const wr = window.apiClient.workRequestCache.getById(record.workRequestId);
        if (wr) {
          if (!Array.isArray(wr.linkedInvoiceIds)) wr.linkedInvoiceIds = [];
          if (!wr.linkedInvoiceIds.includes(record.id)) wr.linkedInvoiceIds.push(record.id);
        }
        if (typeof window.apiClient.workRequestCache.ensure === 'function') {
          window.apiClient.workRequestCache.ensure().catch(() => {});
        }
      }
      // Also patch the operations module cache so the work-request detail/board
      // reflects the new invoice link without a full reload.
      if (typeof WorkflowData !== 'undefined' && WorkflowData.getWorkRequestById) {
        const wfWr = WorkflowData.getWorkRequestById(record.workRequestId);
        if (wfWr) {
          if (!Array.isArray(wfWr.linkedInvoiceIds)) wfWr.linkedInvoiceIds = [];
          if (!wfWr.linkedInvoiceIds.includes(record.id)) wfWr.linkedInvoiceIds.push(record.id);
        }
      }
    }
    if (typeof Dashboard !== 'undefined') {
      if (typeof Dashboard.invalidateCache === 'function') Dashboard.invalidateCache();
      else if (Dashboard._dataCache) Dashboard._dataCache = null;
    }
  },

  _updateCounts(activeDelta = 0, archivedDelta = 0) {
    if (!this._counts || this._countsEntity !== Auth.activeEntity) return;
    this._counts.active = Math.max(0, (this._counts.active || 0) + activeDelta);
    this._counts.archived = Math.max(0, (this._counts.archived || 0) + archivedDelta);
  },

  _isEntityFresh() {
    const entity = Auth.activeEntity;
    return this._detailCacheEntity === entity ||
      this._listCacheEntity === entity ||
      this._countsEntity === entity;
  },

  async _fetchInvoiceAndRerender(id) {
    if (!id) return;
    try {
      const res = await window.apiClient.invoices.get(id);
      if (res?.data) {
        this._detailCache[id] = this.normalizeInvoice(res.data);
        this._detailCacheEntity = Auth.activeEntity;
        App.handleRoute();
      }
    } catch (err) {
      console.error('Failed to fetch invoice', id, err);
    }
  },

  async _loadPrefilledOpReq() {
    if (!this.prefilledRequestId) {
      this._prefilledOpReq = null;
      return;
    }
    try {
      const res = await window.apiClient.operationsRequests.get(this.prefilledRequestId);
      this._prefilledOpReq = res.data || null;
    } catch (err) {
      console.error('Failed to load prefilled operations request', this.prefilledRequestId, err);
      this._prefilledOpReq = null;
    }
  },

  /**
   * Fetch badge counts from the API and cache them on the module.
   * The backend sums across entities when Auth.activeEntity is 'ALL'.
   * Counts are entity-tagged and only re-fetched when stale or forced.
   */
  async loadCounts(force = false) {
    const entity = Auth.activeEntity;
    if (!force && this._counts && this._countsEntity === entity) {
      return this._counts;
    }
    try {
      const res = await window.apiClient.invoices.counts();
      this._counts = { ...(res?.data || {}), templates: (res?.data?.templates || 0) };
      this._countsEntity = entity;
    } catch (err) {
      console.error('Failed to load invoice counts', err);
      this._counts = { active: 0, archived: 0, rejected: 0, templates: 0 };
      this._countsEntity = entity;
    }
    return this._counts;
  },

  /**
   * Load the number of rejected invoice changes and rejected billing requests
   * for the archive badge. Caches the result per entity; does NOT call /counts.
   */
  async loadRejectedCount(force = false) {
    const entity = Auth.activeEntity;
    if (!force && this._counts && this._countsEntity === entity && typeof this._counts.rejected === 'number') {
      return this._counts.rejected;
    }

    let rejected = 0;
    try {
      const [pendingRes, opReqRes] = await Promise.all([
        window.apiClient.admin.listPendingApprovals({ status: 'rejected', tableName: 'invoices' }),
        window.apiClient.operationsRequests.list({ status: 'rejected', type: 'billing' })
      ]);
      const isManagerial = Auth.isManagerial();
      const entFilter = e => entity === 'ALL'
        ? Auth.user.entities.map(ae => ae.toUpperCase()).includes((e || '').toUpperCase())
        : (e || '').toUpperCase() === entity.toUpperCase();

      const rejectedInvoiceChanges = (pendingRes.data || []).filter(pc => {
        const data = pc.proposedData || {};
        if (!entFilter(data.entity)) return false;
        if (!isManagerial && pc.submittedBy !== Auth.user?.id) return false;
        return true;
      }).length;

      const rejectedBillingRequests = (opReqRes.data || []).filter(r => {
        if (!entFilter(r.entity)) return false;
        if (!isManagerial && r.requestedBy !== Auth.user?.id) return false;
        return true;
      }).length;

      rejected = rejectedInvoiceChanges + rejectedBillingRequests;
    } catch (err) {
      console.error('Failed to load rejected invoice counts', err);
    }

    const changed = !this._counts || this._countsEntity !== entity || this._counts.rejected !== rejected;
    this._counts = { ...(this._counts || {}), rejected, active: 0, archived: 0, templates: (this._counts?.templates || 0) };
    this._countsEntity = entity;
    if (changed) App.handleRoute();
    return rejected;
  },

  async render() {
    const container = el('div', { class: 'page' });
    if (!this._isEntityFresh()) this.invalidateCache();

    const needsInvoice = (this.view === 'detail' || this.view === 'form') && this.detailId;
    if (needsInvoice && !this.getInvoiceById(this.detailId)) {
      this._fetchInvoiceAndRerender(this.detailId);
      container.appendChild(el('div', { class: 'loading-skeleton', style: 'padding: 24px;', text: 'Loading invoice...' }));
      return container;
    }

    if (this.view === 'detail' && this.detailId) {
      const inv = this.getInvoiceById(this.detailId);
      const titleBar = el('div', { class: 'page-title-bar-v2' });
      const h1 = el('h1', { class: 'breadcrumb-h1' });
      const baseLink = el('a', { href: 'javascript:void(0)', class: 'breadcrumb-base', text: 'Billing' });
      baseLink.addEventListener('click', () => { location.hash = '#billing'; });
      h1.appendChild(baseLink);
      h1.appendChild(el('span', { class: 'breadcrumb-sep', text: ' / ' }));
      h1.appendChild(document.createTextNode(inv?.invoiceNumber || 'Detail'));
      titleBar.appendChild(h1);

      const actions = el('div', { class: 'title-bar-actions' });
      if (inv && inv.status !== 'Draft' && inv.status !== 'Pending') {
        const noLogoLabel = el('label', { style: 'margin-right:12px; font-size:0.8125rem; display:inline-flex; align-items:center; gap:6px; cursor:pointer; color:var(--color-text-muted);' });
        const noLogoCheckbox = el('input', { type: 'checkbox', id: 'print-no-logo' });
        noLogoLabel.appendChild(noLogoCheckbox);
        noLogoLabel.appendChild(document.createTextNode('No Logo (Generic)'));
        actions.appendChild(noLogoLabel);

        const genInvBtn = el('button', { class: 'btn btn-primary btn-sm', text: 'Print Invoice', style: 'margin-right:8px;' });
        genInvBtn.addEventListener('click', () => {
          const noLogo = noLogoCheckbox.checked;
          this.generateInvoice(inv, noLogo);
        });
        actions.appendChild(genInvBtn);
        const genVouchBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Print Voucher (No Header)', style: 'margin-right:8px;' });
        genVouchBtn.addEventListener('click', () => this.generateVoucher(inv));
        actions.appendChild(genVouchBtn);
      }
      const backBtn = el('button', { class: 'btn btn-secondary btn-sm', text: '← Back to Invoices' });
      backBtn.addEventListener('click', () => { location.hash = '#billing'; });
      actions.appendChild(backBtn);
      titleBar.appendChild(actions);
      container.appendChild(titleBar);
    } else if (this.view === 'form') {
      container.classList.add('billing-tab-page');
      const isNew = !this.detailId;
      const inv = isNew ? null : this.getInvoiceById(this.detailId);
      const fullPageRoute = isNew ? '#billing/form/new' : `#billing/form/${this.detailId}`;
      const viewSwitcher = buildFormViewSwitcher({
        currentMode: PaneMode.FULL_PAGE,
        viewContext: 'invoice-form',
        onSidePeek: () => {
          const invoiceId = this.detailId;
          closeFormPanelAndRoute('#billing');
          this.showForm(invoiceId, PaneMode.SIDE_PEEK);
        },
        onCenterPeek: () => {
          const invoiceId = this.detailId;
          closeFormPanelAndRoute('#billing');
          this.showForm(invoiceId, PaneMode.CENTER_PEEK);
        },
        onNewTab: () => {
          window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
        }
      });
      container.appendChild(buildFormBreadcrumb({
        baseLabel: 'Billing',
        baseHash: '#billing',
        currentText: isNew ? 'New Invoice' : (inv?.invoiceNumber || 'Edit Invoice'),
        viewSwitcher,
        actions: [
          { text: isNew ? 'Save Invoice' : 'Save Changes', class: 'btn btn-primary btn-sm', type: 'submit', form: 'invoice-form' },
          { text: 'Cancel', class: 'btn btn-secondary btn-sm', onClick: () => { location.hash = '#billing'; } }
        ]
      }));
    } else if (this.view === 'templateForm') {
      container.classList.add('billing-tab-page');
      const isNew = !this.templateEditingId;
      const template = isNew ? null : await this.getTemplateById(this.templateEditingId);
      const fullPageRoute = isNew ? '#billing/templateForm/new' : `#billing/templateForm/${this.templateEditingId}`;
      const viewSwitcher = buildFormViewSwitcher({
        currentMode: PaneMode.FULL_PAGE,
        viewContext: 'billing-template-form',
        onSidePeek: () => {
          closeFormPanelAndRoute('#billing');
          this.showTemplateForm(template, PaneMode.SIDE_PEEK);
        },
        onCenterPeek: () => {
          closeFormPanelAndRoute('#billing');
          this.showTemplateForm(template, PaneMode.CENTER_PEEK);
        },
        onNewTab: () => {
          window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
        }
      });
      container.appendChild(buildFormBreadcrumb({
        baseLabel: 'Billing',
        baseHash: '#billing',
        currentText: isNew ? 'New Billing Template' : (template?.name || 'Edit Template'),
        viewSwitcher,
        actions: [
          { text: 'Save Template', class: 'btn btn-primary btn-sm', type: 'submit', form: 'billing-tpl-form' },
          { text: 'Cancel', class: 'btn btn-secondary btn-sm', onClick: () => { location.hash = '#billing'; } }
        ]
      }));
    } else {
      container.classList.add('billing-tab-page');
      // Tab views: list, templates, aging, archive
      const titleBar = el('div', { class: 'page-title-bar-v2' });
      titleBar.appendChild(el('h1', { text: 'Billing' }));
      container.appendChild(titleBar);

      // Tab navigation (counts are derived from the local cache; no /counts API call).
      container.appendChild(this.renderTabNav());
    }

    if (this.view === 'list') container.appendChild(await this.renderList());
    else if (this.view === 'form') {
      await this._loadPrefilledOpReq();
      container.appendChild(await this.renderForm(this.detailId));
    }
    else if (this.view === 'detail') container.appendChild(this.renderDetail());
    else if (this.view === 'aging') {
      const agingContainer = el('div');
      container.appendChild(agingContainer);
      this.renderAging().then(el => agingContainer.appendChild(el));
    }
    else if (this.view === 'templates') container.appendChild(await this.renderTemplates());
    else if (this.view === 'archive') container.appendChild(await this.renderArchive());
    else if (this.view === 'templateForm') container.appendChild(this.renderTemplateForm({ hideHeader: true, template }));

    setTimeout(() => this.updateStickyOffsets(), 0);
    return container;
  },

  init() {
    this.updateStickyOffsets();
  },

  updateStickyOffsets() {
    App.updateStickyOffsets();
  },

  renderTabNav() {
    const entity = Auth.activeEntity;
    // Kick off a one-time load of rejected records for the archive badge;
    // active/archived invoice counts are computed entirely from the local cache.
    this.loadRejectedCount();

    const cachedInvoices = (Array.isArray(this._listCache) && this._listCacheEntity === entity) ? this._listCache : [];
    const invoiceCount = cachedInvoices.filter(inv => this._isActiveInvoice(inv, entity)).length;
    const archiveCount = cachedInvoices.filter(inv => this._isArchiveInvoice(inv, entity)).length + (this._counts?.rejected || 0);
    const templateCount = (this._templates || []).filter(t => this._entityMatches(t.entity, entity)).length;

    const tabs = [
      { key: 'list', label: 'Invoices', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', count: invoiceCount },
      { key: 'templates', label: 'Templates', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>', count: templateCount },
      { key: 'aging', label: 'Aging Report', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
      { key: 'archive', label: 'Archive', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>', count: archiveCount }
    ];

    const tabNav = renderModuleTabNav(tabs, this.view, (key) => {
      this.view = key;
      App.handleRoute();
    });

    const canCreate = Auth.can('billing:edit');
    const canRequest = Auth.can('billing:request');

    if (canCreate && canRequest) {
      const wrapper = el('div', { class: 'split-btn-group' });

      const primaryBtn = el('button', {
        class: 'btn btn-primary btn-sm split-btn-left'
      });
      primaryBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Billing';
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
      requestItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Request Billing';
      requestItem.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.add('hidden');
        Billing.showRequestInvoiceModal();
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
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Billing'
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
      reqBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Request Billing';
      reqBtn.addEventListener('click', () => { Billing.showRequestInvoiceModal(); });
      tabNav.appendChild(reqBtn);
    }

    return tabNav;
  },

  getPaidAmount(inv) {
    if (Array.isArray(inv.payments)) {
      return inv.payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    }
    return inv.paidAmount || 0;
  },

  getSubtotal(inv) {
    if (typeof inv.subtotal === 'number') return inv.subtotal;
    if (Array.isArray(inv.lineItems)) {
      return inv.lineItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    }
    return 0;
  },

  getInvoiceSequenceMap(invoices) {
    const sorted = [...(invoices || [])].sort((a, b) => {
      const ta = new Date(a.createdAt || a.issueDate || 0).getTime();
      const tb = new Date(b.createdAt || b.issueDate || 0).getTime();
      if (ta !== tb) return ta - tb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    const map = new Map();
    sorted.forEach((item, idx) => map.set(item.id, idx + 1));
    return map;
  },

  _entityCodeFromId(entityId) {
    if (!entityId) return null;
    return Auth.activeEntity !== 'ALL' ? Auth.activeEntity : null;
  },

  normalizeInvoice(doc, entityCodeHint) {
    if (!doc) return doc;
    const entity = entityCodeHint
      || doc.entityCode
      || doc.entity_code
      || (typeof doc.entity === 'string' && ['ATA', 'LTA'].includes(doc.entity.toUpperCase()) ? doc.entity : null)
      || this._entityCodeFromId(doc.entity_id || doc.entityId)
      || Auth.activeEntity;
    const normLineItem = item => ({
      id: item.id,
      invoiceId: item.invoice_id || item.invoiceId,
      description: item.description || '',
      amount: parseFloat(item.amount) || 0,
      type: item.type || 'Professional Fee',
      sortOrder: item.sort_order,
      createdAt: item.created_at
    });
    const normPayment = p => ({
      id: p.id,
      invoiceId: p.invoice_id || p.invoiceId,
      amount: parseFloat(p.amount) || 0,
      method: p.method || '',
      reference: p.reference || '',
      date: p.payment_date || p.date,
      notes: p.notes || '',
      recordedBy: p.recorded_by || p.recordedBy,
      recordedAt: p.created_at || p.recordedAt,
      collectedBy: p.collected_by || p.collectedBy || '',
      checkNumber: p.check_number || p.checkNumber || '',
      bankName: p.bank_name || p.bankName || '',
      bankAccount: p.bank_account || p.bankAccount || '',
      transactionId: p.transaction_id || p.transactionId || '',
      digitalAccount: p.digital_account || p.digitalAccount || '',
      cardLast4: p.card_last4 || p.cardLast4 || ''
    });
    return {
      id: doc.id,
      invoiceNumber: doc.invoice_number || doc.invoiceNumber,
      clientId: doc.client_id || doc.clientId,
      workRequestId: doc.work_request_id || doc.workRequestId,
      linkedTaskId: doc.linked_task_id || doc.linkedTaskId || null,
      entityId: doc.entity_id || doc.entityId,
      entity,
      issueDate: doc.issue_date || doc.issueDate,
      dueDate: doc.due_date || doc.dueDate,
      status: doc.status || 'Draft',
      subtotal: parseFloat(doc.subtotal) || 0,
      vat: parseFloat(doc.tax_amount) || parseFloat(doc.vat) || 0,
      total: parseFloat(doc.total) || 0,
      paidAmount: parseFloat(doc.amount_paid) || parseFloat(doc.paidAmount) || 0,
      balance: parseFloat(doc.balance) || (parseFloat(doc.total || 0) - parseFloat(doc.amount_paid || 0)),
      notes: doc.notes || null,
      terms: doc.terms || null,
      archived: !!doc.archived,
      createdBy: doc.created_by || doc.createdBy,
      updatedBy: doc.updated_by || doc.updatedBy,
      createdAt: doc.created_at || doc.createdAt,
      updatedAt: doc.updated_at || doc.updatedAt,
      deletedAt: doc.deleted_at || doc.deletedAt,
      boardOrder: doc.board_order || doc.boardOrder,
      fromTemplate: doc.from_template || doc.fromTemplate,
      lineItems: doc.line_items ? (doc.line_items || []).map(normLineItem) : (doc.lineItems || []).map(normLineItem),
      payments: (doc.payments || []).map(normPayment),
      clientName: doc.clients?.name || doc.clientName || null
    };
  },

  toApiInvoice(record) {
    return {
      clientId: record.clientId,
      workRequestId: record.workRequestId || null,
      invoiceNumber: record.invoiceNumber,
      issueDate: record.issueDate,
      dueDate: record.dueDate,
      status: record.status,
      lineItems: (record.lineItems || []).map(item => ({
        description: item.description,
        amount: parseFloat(item.amount) || 0,
        type: item.type || 'Professional Fee'
      })),
      notes: record.notes || null,
      terms: record.terms || null,
      archived: record.archived
    };
  },

  normalizeTemplate(doc) {
    if (!doc) return doc;
    return {
      id: doc.id,
      name: doc.name,
      entity: doc.entity_id || doc.entity,
      clientId: doc.client_id || doc.clientId,
      schedule: doc.schedule,
      pfAmount: parseFloat(doc.pf_amount) || 0,
      lineItems: (doc.line_items || doc.lineItems || []).map(item => ({
        description: item.description || '',
        amount: parseFloat(item.amount) || 0,
        type: item.type || 'Professional Fee'
      })),
      active: doc.active !== false,
      createdAt: doc.created_at || doc.createdAt,
      updatedAt: doc.updated_at || doc.updatedAt,
      clientName: doc.clients?.name || doc.clientName || null
    };
  },

  toApiTemplate(record) {
    return {
      name: record.name,
      clientId: record.clientId || null,
      schedule: record.schedule,
      pfAmount: parseFloat(record.pfAmount) || 0,
      lineItems: (record.lineItems || []).map(item => ({
        description: item.description,
        amount: parseFloat(item.amount) || 0,
        type: item.type || 'Professional Fee'
      }))
    };
  },

  async fetchInvoices(query = {}) {
    const entity = Auth.activeEntity;
    const loadGen = this._listCacheGeneration;
    try {
      const res = await window.apiClient.invoices.list(query);
      // If the cache was invalidated or the entity changed while this request
      // was in flight, discard the stale result so it cannot clobber newer data.
      if (loadGen !== this._listCacheGeneration || entity !== Auth.activeEntity) {
        this._lastInvoiceMeta = {};
        return [];
      }
      this._lastInvoiceMeta = res.meta || {};
      const invoices = (res.data || []).map(inv => this.normalizeInvoice(inv));
      invoices.forEach(inv => { this._detailCache[inv.id] = inv; });
      this._detailCacheEntity = entity;
      // Merge fetched entity invoices into the all-invoice cache so active and
      // archive counts can be derived locally. Small-limit fetches are ignored.
      const isListFetch = (query.limit || 50) >= 10;
      if (isListFetch) {
        this._listCacheEntity = entity;
        invoices.forEach(inv => this._addToListCache(inv));
      }
      return invoices;
    } catch (e) {
      if (isAbortError(e)) { this._lastInvoiceMeta = {}; return []; }
      console.error('Failed to fetch invoices', e);
      Workflow.showMessage('Invoices', e.message || 'Unable to load invoices.', 'error');
      this._lastInvoiceMeta = {};
      return [];
    }
  },

  async fetchTemplates() {
    try {
      const res = await window.apiClient.invoices.listTemplates();
      return (res.data || []).map(t => this.normalizeTemplate(t));
    } catch (e) {
      console.error('Failed to fetch billing templates', e);
      return [];
    }
  },

  _isTemplatesFresh() {
    return this._templatesEntity === Auth.activeEntity;
  },

  async ensureTemplates() {
    const skipping = this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration;
    if (skipping || this._isTemplatesFresh()) return;
    if (this._templatesPromise) return this._templatesPromise;
    const loadGen = ++this._templatesGeneration;
    this._templatesPromise = this._loadTemplates(loadGen).finally(() => {
      if (this._templatesGeneration === loadGen) this._templatesPromise = null;
    });
    return this._templatesPromise;
  },

  async _loadTemplates(loadGen, { merge = false } = {}) {
    const entity = Auth.activeEntity;
    try {
      const all = await this.fetchTemplates();
      if (loadGen !== this._templatesGeneration || Auth.activeEntity !== entity) {
        return this._templates || [];
      }
      const filtered = all.filter(t => {
        if (entity === 'ALL') {
          return Auth.user.entities.map(e => e.toUpperCase()).includes((t.entity || '').toUpperCase());
        }
        return (t.entity || '').toUpperCase() === entity.toUpperCase();
      });
      if (merge && this._templatesEntity === entity) {
        const existingMap = new Map(this._templates.map(t => [t.id, t]));
        filtered.forEach(t => {
          const existing = existingMap.get(t.id);
          if (existing) Object.assign(existing, t);
          else if (!this._isTempId(t.id)) this._templates.push(t);
        });
      } else {
        this._templates = filtered;
      }
      this._templatesEntity = entity;
      return this._templates;
    } catch (e) {
      console.error('Failed to load billing templates', e);
      if (loadGen !== this._templatesGeneration) return this._templates || [];
      if (!Array.isArray(this._templates)) this._templates = [];
      this._templatesEntity = entity;
      return this._templates;
    }
  },

  async backgroundRefreshTemplates() {
    if (this._templatesBackgroundPromise) return this._templatesBackgroundPromise;
    const loadGen = ++this._templatesGeneration;
    this._templatesBackgroundPromise = this._loadTemplates(loadGen, { merge: true }).finally(() => {
      if (this._templatesGeneration === loadGen) this._templatesBackgroundPromise = null;
    });
    return this._templatesBackgroundPromise;
  },

  /**
   * Load billing templates for the active entity into a local cache.
   * Deduplicates concurrent calls via _templatesPromise.
   */
  async loadTemplates() {
    await this.ensureTemplates();
    return this._templates;
  },

  /**
   * Get a template by ID from the cache, or fetch the list and find it if missing.
   * Falls back to the local DB only if the API call fails and a local record exists.
   */
  async getTemplateById(id) {
    if (!id) return null;
    const cached = this._templates.find(t => t.id === id);
    if (cached) return deepClone(cached);
    try {
      await this.ensureTemplates();
      const template = this._templates.find(t => t.id === id) || null;
      return template ? deepClone(template) : null;
    } catch (e) {
      console.error('Failed to fetch template by id', id, e);
      return null;
    }
  },

  // ============================================================
  // List View
  // ============================================================
  renderList() {
    const entity = Auth.activeEntity;
    const wrapper = el('div');
    const stickyContainer = el('div', { class: 'toolbar-sticky-container' });

    // Jira Filter Toolbar & Active Filters State
    const activeFilters = {
      workRequest: new Set(),
      client: new Set(),
      employee: new Set(),
      status: new Set(),
      date: new Set()
    };

    let searchQuery = '';

    const savedFilters = App.restoreFilters('billing');
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
      App.saveFilters('billing', {
        workRequest: Array.from(activeFilters.workRequest),
        client: Array.from(activeFilters.client),
        employee: Array.from(activeFilters.employee),
        status: Array.from(activeFilters.status),
        date: Array.from(activeFilters.date)
      });
    };

    const entMatches = (val) => {
      const u = (val || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(u);
      return u === entity.toUpperCase();
    };

    const getWorkRequestOptions = () => {
      const wrs = window.apiClient.workRequestCache._wrs || [];
      return wrs.filter(wr => entMatches(wr.entity)).map(wr => ({ value: wr.id, label: wr.title }));
    };

    const getClientOptions = () => {
      const clients = window.apiClient.clientCache._clients || [];
      return clients.filter(c => entMatches(c.entity)).map(c => ({ value: c.id, label: c.name }));
    };

    const getEmployeeOptions = () => {
      const set = new Set();
      const users = window.apiClient.userCache._users || [];
      users.filter(u => {
        const userEnts = (u.entities || []).map(e => e.toUpperCase());
        return entity === 'ALL' ? userEnts.some(e => Auth.user.entities.map(ae => ae.toUpperCase()).includes(e)) : userEnts.includes(entity.toUpperCase());
      }).forEach(u => set.add(u.name));
      return Array.from(set).map(n => ({ value: n, label: n }));
    };

    const getStatusOptions = () => [
      { value: 'Draft', label: 'Draft' },
      { value: 'Pending', label: 'Pending' },
      { value: 'Approved', label: 'Approved' },
      { value: 'Sent', label: 'Sent' },
      { value: 'Partially Paid', label: 'Partially Paid' },
      { value: 'Paid', label: 'Paid' },
      { value: 'Overdue', label: 'Overdue' },
      { value: 'Cancelled', label: 'Cancelled' }
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

    let viewMode = App.getPreferredViewMode('billing') || 'table';
    let groupBy = App.restoreGroupBy('billing') || 'none';

    const groupOptions = [
      { key: 'none', label: 'None' },
      { key: 'client', label: 'Client', getName: inv => {
        const client = window.apiClient.clientCache.getById(inv.clientId);
        return client?.name || 'No Client';
      }},
      { key: 'employee', label: 'Employee', getName: inv => {
        const creator = inv.createdBy ? window.apiClient.userCache.getById(inv.createdBy) : null;
        return creator?.name || 'Unassigned';
      }},
      { key: 'workRequest', label: 'Work Request', getName: inv => {
        const wr = window.apiClient.workRequestCache.getById(inv.workRequestId);
        return wr?.title || 'No Work Request';
      }}
    ];

    const contentContainer = el('div');
    wrapper.appendChild(contentContainer);

    const pageLimit = 50;
    let currentPage = this.currentListPage || 1;

    const refresh = async () => {
      contentContainer.replaceChildren();

      // Ensure the in-memory cache is loaded for the active entity. If it is
      // already warm (including during an optimistic skip), this returns immediately.
      const skipping = this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration;
      if (!skipping) await this.ensure();

      let baseInvoices = (this._listCache || []).filter(inv => this._isActiveInvoice(inv, entity));

      let pendingInvs = [];
      try {
        const pendingRes = await window.apiClient.pendingApprovals.list({ status: 'pending', tableName: 'invoices' });
        pendingInvs = (pendingRes.data || []).filter(pc => {
          const inv = pc.proposedData || {};
          const matchesEntity = (entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes((inv.entity || '').toUpperCase()) : (inv.entity || '').toUpperCase() === entity.toUpperCase());
          if (!matchesEntity) return false;
          if (!Auth.can('billing:approve') && pc.submittedBy !== Auth.user?.id) return false;
          return true;
        }).map(pc => {
          const inv = deepClone(pc.proposedData);
          inv.status = 'Pending';
          inv.pendingChangeId = pc.id;
          return inv;
        });
      } catch (e) {
        if (e.name !== 'AbortError' && e.message !== 'route-change' && !e.message?.includes('aborted')) {
          console.error('Failed to load pending invoice approvals', e);
        }
      }

      const hasInvoices = baseInvoices.length > 0 || pendingInvs.length > 0;
      let invoices = [...baseInvoices, ...pendingInvs];

      if (activeFilters.workRequest.size > 0) {
        invoices = invoices.filter(inv => activeFilters.workRequest.has(inv.workRequestId));
      }
      if (activeFilters.client.size > 0) {
        invoices = invoices.filter(inv => activeFilters.client.has(inv.clientId));
      }
      if (activeFilters.employee.size > 0) {
        invoices = invoices.filter(inv => {
          const creator = inv.createdBy ? window.apiClient.userCache.getById(inv.createdBy) : null;
          if (creator && activeFilters.employee.has(creator.name)) return true;
          const wr = inv.workRequestId ? window.apiClient.workRequestCache.getById(inv.workRequestId) : null;
          const tasks = wr?.tasks || [];
          return tasks.some(t => {
            const u = t.assigneeId ? window.apiClient.userCache.getById(t.assigneeId) : null;
            return (u && activeFilters.employee.has(u.name)) || activeFilters.employee.has(t.assigneeName);
          });
        });
      }
      if (activeFilters.status.size > 0) {
        invoices = invoices.filter(inv => activeFilters.status.has(inv.status));
      }
      if (activeFilters.date.size > 0) {
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        const endOfWeek = new Date(now);
        endOfWeek.setDate(now.getDate() + (now.getDay() === 0 ? 0 : 7 - now.getDay()));
        const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const endOfMonthStr = endOfMonth.toISOString().slice(0, 10);

        invoices = invoices.filter(inv => {
          if (!inv.dueDate && !inv.issueDate) return false;
          const dStr = (inv.dueDate || inv.issueDate).slice(0, 10);
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
      if (searchQuery) {
        invoices = invoices.filter(inv => {
          const client = window.apiClient.clientCache.getById(inv.clientId);
          const hay = [
            inv.invoiceNumber || '',
            client?.name || '',
            inv.status || '',
            String(inv.total || ''),
          ].join(' ').toLowerCase();
          return hay.includes(searchQuery);
        });
      }

      const hasActiveFilters = searchQuery || Object.values(activeFilters).some(s => s && s.size > 0);

      // Client-side pagination over the filtered cached set.
      const totalItems = invoices.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageLimit));
      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      this.currentListPage = currentPage;
      const start = (currentPage - 1) * pageLimit;
      const paginatedInvoices = invoices.slice(start, start + pageLimit);

      if (paginatedInvoices.length === 0 && hasActiveFilters && hasInvoices) {
        contentContainer.appendChild(renderFilterEmptyState(
          'No invoices match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('billing'); App.handleRoute(); } }]
        ));
      } else if (viewMode === 'table') {
        this.refreshTable(contentContainer, paginatedInvoices);
      } else if (viewMode === 'board') {
        this.refreshBoard(contentContainer, paginatedInvoices, groupBy, groupOptions, stickyContainer);
      } else {
        this.refreshListCompact(contentContainer, paginatedInvoices);
      }

      // Pagination controls (client-side)
      const paginationBar = el('div', { class: 'pagination-bar', style: 'display:flex; justify-content:center; align-items:center; gap:12px; margin-top:16px;' });
      const prevBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Previous', disabled: currentPage <= 1 });
      const pageInfo = el('span', { text: `Page ${currentPage} of ${totalPages}` });
      const nextBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Next', disabled: currentPage >= totalPages });
      prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          this.currentListPage = currentPage;
          refresh();
        }
      });
      nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
          currentPage++;
          this.currentListPage = currentPage;
          refresh();
        }
      });
      paginationBar.appendChild(prevBtn);
      paginationBar.appendChild(pageInfo);
      paginationBar.appendChild(nextBtn);
      contentContainer.appendChild(paginationBar);
    };

    (async () => {
      await Promise.all([window.apiClient.userCache.ensure(), window.apiClient.clientCache.ensure(), window.apiClient.workRequestCache.ensure()]);
      const toolbarContainer = createJiraFilterToolbar({
        moduleName: 'billing',
        searchConfig: {
          placeholder: 'Search billing...',
          onSearch: (q) => { searchQuery = q; currentPage = 1; this.currentListPage = 1; refresh(); }
        },
        categories,
        activeFilters,
        onFilterChange: () => {
          saveCurrentFilters();
          currentPage = 1;
          this.currentListPage = 1;
          refresh();
        },
        viewMode,
        onViewModeChange: (newMode) => {
          viewMode = newMode;
          App.setPreferredViewMode('billing', newMode);
          saveCurrentFilters();
          refresh();
        },
        groupByOptions: groupOptions,
        currentGroupBy: groupBy,
        onGroupByChange: (newGroupBy) => {
          groupBy = newGroupBy;
          App.saveGroupBy('billing', groupBy);
          refresh();
        }
      });
      stickyContainer.appendChild(toolbarContainer);
      wrapper.insertBefore(stickyContainer, contentContainer);
      await refresh();
      // Background refresh: silently merge any new/updated server records into
      // the in-memory cache without replacing optimistic records.
      this.backgroundRefresh().catch(err => {
        if (!isAbortError(err)) console.warn('Billing background refresh failed', err);
      });
    })();

    return wrapper;
  },

  refreshTable(container, invoices) {
    if (invoices.length === 0) {
      container.appendChild(renderEmptyState('No invoices found', null, { variant: 'zero-state' }));
      return;
    }

    const buildActions = (inv) => {
      const wrapper = el('div', { style: 'display: inline-flex; gap: 4px; align-items: center;' });
      const viewBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'View' });
      viewBtn.addEventListener('click', (e) => { e.stopPropagation(); location.hash = '#billing/detail/' + inv.id; });
      wrapper.appendChild(viewBtn);

      if (inv.status === 'Draft' && Auth.can('billing:edit')) {
        const editBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Edit', style: 'margin-left:4px;' });
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showForm(inv.id); });
        wrapper.appendChild(editBtn);
        const trashBtn = el('button', { class: 'btn btn-danger btn-sm', text: 'Trash', style: 'margin-left:4px;' });
        trashBtn.addEventListener('click', (e) => { e.stopPropagation(); this.trashInvoice(inv.id); });
        wrapper.appendChild(trashBtn);
      }

      if (inv.status === 'Paid' && !inv.archived) {
        const archiveBtn = el('button', { class: 'btn btn-primary btn-sm', text: 'Archive', style: 'margin-left:4px;' });
        archiveBtn.addEventListener('click', (e) => { e.stopPropagation(); this.archiveInvoice(inv.id); });
        wrapper.appendChild(archiveBtn);
      }

      return wrapper;
    };

    const columns = [
      {
        key: 'invoiceNumber',
        label: 'Invoice #',
        width: '25%',
        render: (inv) => {
          const cell = el('div', { class: 'dt-title-cell' });
          const line = el('div', { style: 'display: flex; align-items: center; gap: 6px; flex-wrap: wrap;' });
          line.appendChild(el('span', { class: 'dt-title-link', text: inv.invoiceNumber || '—' }));
          if (inv.fromTemplate) line.appendChild(this.recurringBadge(inv));
          cell.appendChild(line);
          if (inv.workRequestId) {
            const wr = window.apiClient.workRequestCache.getById(inv.workRequestId);
            if (wr) {
              const sub = el('div', { style: 'font-size: 0.725rem; color: var(--color-text-muted);' });
              let suffix = ' (Entire WR)';
              if (inv.linkedTaskId) {
                const task = (wr.tasks || []).find(t => t.id === inv.linkedTaskId);
                if (task) suffix = ` (Task: ${task.title})`;
              }
              sub.appendChild(el('span', { text: '🔗 ' + wr.title + suffix, style: 'font-weight: 500;' }));
              cell.appendChild(sub);
            }
          }
          return cell;
        }
      },
      { key: 'clientId', label: 'Client', render: (inv) => window.apiClient.clientCache.getById(inv.clientId)?.name || '—' },
      { key: 'issueDate', label: 'Issue Date', render: (inv) => formatDate(inv.issueDate), width: '110px' },
      { key: 'total', label: 'Total', render: (inv) => formatPHP(inv.total || 0), align: 'right', width: '100px' },
      { key: 'paid', label: 'Paid', render: (inv) => formatPHP(this.getPaidAmount(inv)), align: 'right', width: '100px' },
      { key: 'balance', label: 'Balance', render: (inv) => formatPHP((inv.total || 0) - this.getPaidAmount(inv)), align: 'right', width: '100px' },
      { key: 'status', label: 'Status', render: (inv) => this.statusBadge(inv.status), width: '110px' },
      { key: 'actions', label: 'Actions', render: (inv) => buildActions(inv), class: 'dt-actions-col', width: '180px' }
    ];

    const tableView = DataTable.render({
      items: invoices,
      columns,
      selectable: true,
      bulkActions: (ids) => {
        const rows = ids.map(id => invoices.find(inv => inv.id === id)).filter(Boolean);
        const canArchive = rows.filter(inv => inv.status === 'Paid' && !inv.archived).length;
        const canTrash = rows.filter(inv => inv.status === 'Draft' && Auth.can('billing:edit')).length;
        const actions = [];
        if (canArchive > 0) {
          actions.push({
            text: `Archive (${canArchive})`,
            className: 'btn btn-primary btn-sm',
            onClick: (sel) => this.bulkArchiveInvoices(sel)
          });
        }
        if (canTrash > 0) {
          actions.push({
            text: `Trash (${canTrash})`,
            className: 'btn btn-danger btn-sm',
            onClick: (sel) => this.bulkTrashInvoices(sel)
          });
        }
        return actions;
      },
      rowId: (inv) => inv.id,
      onRowClick: (inv) => { if (!inv.pendingChangeId) location.hash = '#billing/detail/' + inv.id; }
    });

    container.appendChild(tableView);
  },

  /**
   * Role-aware board columns for Billing.
   *
   * - Admin: Draft | Released (Sent) | Partially Paid | Paid | Overdue
   *   Pending and Approved are funnelled to the Admin Console and hidden from the board.
   * - Accounting: Draft | Pending | Released (Sent) | Partially Paid | Paid | Overdue
   *   Approved is hidden from the board (action happens via list/detail).
   * - Others: Requested (Draft/Pending/Approved) | Released (Sent) | Partially Paid | Paid | Overdue
   */
  getBoardColumns() {
    const departments = Auth.user?.departments || [];
    const role = Auth.user?.role;
    const isAdmin = role === 'Admin';
    const isAccounting = departments.includes('Accounting');

    const releasedStatuses = ['Sent'];

    if (isAdmin) {
      return [
        { key: 'Draft', label: 'Draft', statuses: ['Draft'], targetStatus: 'Draft', color: '#94a3b8' },
        { key: 'Released', label: 'Released', statuses: releasedStatuses, targetStatus: 'Sent', color: '#3b82f6' },
        { key: 'Partially Paid', label: 'Partially Paid', statuses: ['Partially Paid'], targetStatus: 'Partially Paid', color: '#f59e0b' },
        { key: 'Paid', label: 'Paid', statuses: ['Paid'], targetStatus: 'Paid', color: '#10b981' },
        { key: 'Overdue', label: 'Overdue', statuses: ['Overdue'], targetStatus: 'Overdue', color: '#ef4444' }
      ];
    }

    if (isAccounting) {
      return [
        { key: 'Draft', label: 'Draft', statuses: ['Draft'], targetStatus: 'Draft', color: '#94a3b8' },
        { key: 'Pending', label: 'Pending', statuses: ['Pending'], targetStatus: 'Pending', color: '#f59e0b' },
        { key: 'Released', label: 'Released', statuses: releasedStatuses, targetStatus: 'Sent', color: '#3b82f6' },
        { key: 'Partially Paid', label: 'Partially Paid', statuses: ['Partially Paid'], targetStatus: 'Partially Paid', color: '#f59e0b' },
        { key: 'Paid', label: 'Paid', statuses: ['Paid'], targetStatus: 'Paid', color: '#10b981' },
        { key: 'Overdue', label: 'Overdue', statuses: ['Overdue'], targetStatus: 'Overdue', color: '#ef4444' }
      ];
    }

    return [
      { key: 'Requested', label: 'Requested', statuses: ['Draft', 'Pending', 'Approved'], targetStatus: 'Pending', color: '#94a3b8' },
      { key: 'Released', label: 'Released', statuses: releasedStatuses, targetStatus: 'Sent', color: '#3b82f6' },
      { key: 'Partially Paid', label: 'Partially Paid', statuses: ['Partially Paid'], targetStatus: 'Partially Paid', color: '#f59e0b' },
      { key: 'Paid', label: 'Paid', statuses: ['Paid'], targetStatus: 'Paid', color: '#10b981' },
      { key: 'Overdue', label: 'Overdue', statuses: ['Overdue'], targetStatus: 'Overdue', color: '#ef4444' }
    ];
  },

  getInvoiceDisplayStatus(status) {
    if (status === 'Sent') return 'Released';
    return status;
  },

  refreshBoard(container, invoices, groupBy = 'none', groupOptions = [], toolbarContainer = null) {
    const canEdit = Auth.can('billing:edit');
    const self = this;
    toolbarContainer?.classList.remove('grouped-board-active');
    const boardPhases = this.getBoardColumns();
    const statusColors = {
      'Draft': '#94a3b8',
      'Pending': '#f59e0b',
      'Approved': '#10b981',
      'Sent': '#3b82f6',
      'Partially Paid': '#f59e0b',
      'Paid': '#10b981',
      'Overdue': '#ef4444'
    };

    // Normalize boardOrder within each visible column.
    const sortedInvs = [];
    boardPhases.forEach(phase => {
      const colInvs = invoices.filter(inv => phase.statuses.includes(inv.status) && !inv.pendingChangeId && !inv.archived && inv.status !== 'Cancelled');
      colInvs.sort((a, b) => {
        const oa = typeof a.boardOrder === 'number' ? a.boardOrder : null;
        const ob = typeof b.boardOrder === 'number' ? b.boardOrder : null;
        if (oa !== null && ob !== null) return oa - ob;
        if (oa !== null) return -1;
        if (ob !== null) return 1;
        return new Date(a.createdAt || a.issueDate || 0) - new Date(b.createdAt || b.issueDate || 0);
      });
      colInvs.forEach((inv, idx) => {
        if (this._isTempId(inv.id) || inv.status === 'Cancelled' || inv.archived) return;
        const newOrder = (idx + 1) * 1000;
        if (inv.boardOrder === newOrder) return;
        inv.boardOrder = newOrder;
        window.apiClient.invoices.update(inv.id, { boardOrder: newOrder }).catch(e => {
          if (e.status === 404 || e.statusCode === 404 || e.message?.includes('404') || e.message?.includes('not found') || e.message === 'route-change' || e.message?.includes('aborted')) {
            return;
          }
          console.error('Failed to update board order', e);
        });
      });
      const colPendingInvs = invoices.filter(inv => phase.statuses.includes(inv.status) && inv.pendingChangeId);
      sortedInvs.push(...colInvs, ...colPendingInvs);
    });

    const makeColumns = () => boardPhases.map(phase => {
      const col = {
        ...phase,
        icon: 'phase',
        emptyState: { variant: 'compact', title: 'No invoices', body: '' }
      };
      if (phase.key === 'Draft' && canEdit) {
        col.addButton = { label: 'Add Billing', onClick: () => self.showForm() };
      }
      return col;
    });

    const seqMap = this.getInvoiceSequenceMap(invoices);

    const renderCard = (inv) => {
      const client = window.apiClient.clientCache.getById(inv.clientId);
      const paid = self.getPaidAmount(inv);
      const balance = inv.total - paid;
      const progress = inv.total > 0 ? Math.round((paid / inv.total) * 100) : 0;

      const statusPriorityClass = {
        'Paid': 'card-v2-priority-low',
        'Approved': 'card-v2-priority-low',
        'Sent': 'card-v2-priority-normal',
        'Partially Paid': 'card-v2-priority-medium',
        'Pending': 'card-v2-priority-medium',
        'Draft': 'card-v2-priority-normal',
        'Overdue': 'card-v2-priority-urgent'
      }[inv.status] || 'card-v2-priority-normal';

      const descParts = [inv.invoiceNumber];
      if (inv.workRequestId) {
        const wr = window.apiClient.workRequestCache.getById(inv.workRequestId);
        if (wr) descParts.push(wr.title);
      }
      if (inv.fromTemplate) descParts.push('Recurring');

      const card = buildCompactBoardCard({
        key: 'INV-' + (seqMap.get(inv.id) || 1),
        progress,
        statusColor: statusColors[inv.status] || '#cbd5e1',
        title: inv.invoiceNumber,
        description: client?.name || '—',
        detail: descParts.slice(1).join(' • '),
        date: inv.issueDate ? formatDate(inv.issueDate) : '',
        priority: self.getInvoiceDisplayStatus(inv.status),
        priorityClass: statusPriorityClass,
        isOptimistic: this._isTempId(inv.id),
        onClick: () => { location.hash = '#billing/detail/' + inv.id; }
      });

      const footerRight = card.querySelector('.card-v2-footer-right');
      if (balance > 0 && balance < inv.total) {
        footerRight.appendChild(el('div', { class: 'card-v2-footer-item', text: `Bal ${formatPHP(balance)}`, style: 'font-size:0.7rem;color:var(--color-danger);font-weight:600;' }));
      }
      footerRight.appendChild(el('div', { class: 'card-v2-footer-item', text: formatPHP(inv.total), style: 'font-weight:700;color:var(--color-text);' }));
      return card;
    };

    const cardMenuItems = (inv) => {
      const items = [{
        label: 'View Details',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        onClick: () => { location.hash = '#billing/detail/' + inv.id; }
      }];
      if (canEdit && !inv.pendingChangeId && !inv.archived) {
        if (inv.status === 'Draft') {
          items.push({
            label: 'Edit',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
            onClick: () => self.showForm(inv.id)
          });
        }
        items.push({
          label: 'Trash',
          className: 'danger',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
          onClick: () => self.trashInvoice(inv.id)
        });
      }

      if (inv.status === 'Paid' && !inv.archived) {
        items.push({
          label: 'Archive',
          className: 'primary',
          icon: ArchivePage.icons.archive,
          onClick: () => self.archiveInvoice(inv.id)
        });
      }
      return items;
    };

    const boardDrag = {
      enabled: true,
      canDrag: inv => {
        if (this._isTempId(inv.id)) return false;
        const canManage = canEdit || Auth.can('billing:approve') || Auth.can('billing:mark_paid') || Auth.can('billing:release') || Auth.isManagerial();
        return canManage && !inv.pendingChangeId;
      },
      canDrop: ({ item, targetStatus }) => {
        if (item.status === targetStatus) return true;
        const flow = ['Draft', 'Pending', 'Approved', 'Sent', 'Partially Paid', 'Paid'];
        const currentIdx = flow.indexOf(item.status);
        const targetIdx = flow.indexOf(targetStatus);
        if (currentIdx === -1 || targetIdx === -1) return false;
        if (targetIdx <= currentIdx) return false;

        // Payment status transitions require recorded payments that match the target.
        const paid = self.getPaidAmount(item);
        if (targetStatus === 'Partially Paid') {
          return paid > 0 && paid < item.total;
        }
        if (targetStatus === 'Paid') {
          return item.total > 0 && paid >= item.total;
        }
        return true;
      },
      orderField: 'boardOrder',
      onDropDenied({ item, targetStatus }) {
        const flow = ['Draft', 'Pending', 'Approved', 'Sent', 'Partially Paid', 'Paid'];
        const currentIdx = flow.indexOf(item.status);
        const targetIdx = flow.indexOf(targetStatus);
        // Silently ignore backward moves so cards return to their original position.
        if (currentIdx !== -1 && targetIdx !== -1 && targetIdx < currentIdx) return;

        if (targetStatus !== 'Partially Paid' && targetStatus !== 'Paid') return;
        const paid = self.getPaidAmount(item);
        if (targetStatus === 'Partially Paid') {
          if (paid <= 0) {
            Workflow.showMessage('Payment Required', `Invoice "${item.invoiceNumber}" cannot be marked Partially Paid — no payments have been recorded.`, 'warning');
          } else if (paid >= item.total) {
            Workflow.showMessage('Already Fully Paid', `Invoice "${item.invoiceNumber}" has payments totaling ${formatPHP(paid)}. Use the Paid status instead.`, 'warning');
          }
        } else if (targetStatus === 'Paid') {
          if (item.total <= 0) {
            Workflow.showMessage('Invalid Invoice', `Invoice "${item.invoiceNumber}" has no billable amount and cannot be marked Paid.`, 'warning');
          } else if (paid <= 0) {
            Workflow.showMessage('Payment Required', `Invoice "${item.invoiceNumber}" cannot be marked Paid — no payments have been recorded.`, 'warning');
          } else if (paid < item.total) {
            const balance = item.total - paid;
            Workflow.showMessage('Balance Remaining', `Invoice "${item.invoiceNumber}" still has a balance of ${formatPHP(balance)}. Record the remaining payment before marking Paid.`, 'warning');
          }
        }
      },
      onDrop({ item, targetStatus, newOrder, fromStatus }) {
        if (fromStatus === targetStatus) {
          window.apiClient.invoices.update(item.id, { boardOrder: newOrder }).then(() => App.handleRoute()).catch(e => {
            console.error('Failed to update board order', e);
            Workflow.showMessage('Update Failed', e.message || 'Unable to move invoice.', 'error');
          });
          return;
        }

        // Permission gate: only billing:approve can move to Approved
        if (targetStatus === 'Approved' && !Auth.can('billing:approve')) {
          Workflow.showMessage('Permission Denied', 'Only users with approval rights can approve invoices.', 'danger');
          return;
        }

        // Block if pending admin approval
        if (item.pendingChangeId) {
          Workflow.showMessage('Pending Approval', `Invoice "${item.invoiceNumber}" is pending administrative approval and cannot be moved.`, 'warning');
          return;
        }

        // Block Draft → beyond Pending if no line items
        if (fromStatus === 'Draft' && targetStatus !== 'Pending') {
          const hasItems = item.lineItems && item.lineItems.length > 0;
          if (!hasItems && (!item.total || item.total <= 0)) {
            Workflow.showMessage('Incomplete Invoice', 'Cannot advance — invoice has no line items or amount.', 'warning');
            return;
          }
        }

        const applyMove = async () => {
          const isRelease = targetStatus === 'Sent';
          const canReleaseDirectly = Auth.user?.role === 'Admin' || Auth.isManagerial() || Auth.can('billing:release');
          const nextStatus = (isRelease && !canReleaseDirectly) ? 'Release Pending Approval' : targetStatus;
          try {
            await window.apiClient.invoices.update(item.id, { boardOrder: newOrder, status: nextStatus });
            App.handleRoute();
          } catch (e) {
            console.error('Failed to move invoice', e);
            Workflow.showMessage('Update Failed', e.message || 'Unable to move invoice.', 'error');
          }
        };

        // Confirm critical transitions
        if (['Approved', 'Sent', 'Paid'].includes(targetStatus)) {
          const isRelease = targetStatus === 'Sent';
          const canReleaseDirectly = Auth.user?.role === 'Admin' || Auth.isManagerial() || Auth.can('billing:release');
          const labels = {
            'Approved': { msg: `Approve invoice "${item.invoiceNumber}" (${formatPHP(item.total)})?`, type: 'success' },
            'Sent': { msg: canReleaseDirectly ? `Release invoice "${item.invoiceNumber}" to client?` : `Submit invoice "${item.invoiceNumber}" for release approval?`, type: 'success' },
            'Paid': { msg: `Mark invoice "${item.invoiceNumber}" (${formatPHP(item.total)}) as fully Paid?`, type: 'success' }
          };
          const cfg = labels[targetStatus];
          Workflow.showConfirm('Confirm Status Change', cfg.msg, applyMove, cfg.type);
          return;
        }

        applyMove();
      }
    };

    if (groupBy !== 'none') {
      toolbarContainer?.classList.add('grouped-board-active');
      renderGroupedKanbanBoard({
        container,
        items: sortedInvs,
        columns: makeColumns(),
        toolbarContainer,
        groupBy,
        groupOptions,
        renderCard,
        cardMenuItems,
        storageKey: 'erp_billing_grouped_collapsed',
        drag: boardDrag
      });
      return;
    }

    KanbanBoard.render({
      container,
      items: sortedInvs,
      columns: makeColumns(),
      renderCard,
      cardMenuItems,
      drag: boardDrag
    });
  },

  refreshListCompact(container, invoices) {
    if (invoices.length === 0) {
      container.appendChild(renderEmptyState('No invoices found', null, { variant: 'zero-state' }));
      return;
    }
    const list = el('div', { class: 'list-view' });
    invoices.forEach(inv => {
      const client = window.apiClient.clientCache.getById(inv.clientId);
      const row = el('div', { class: 'list-item' });
      const paid = this.getPaidAmount(inv);
      const balance = inv.total - paid;
      let wrMeta = '';
      if (inv.workRequestId) {
        const wr = window.apiClient.workRequestCache.getById(inv.workRequestId);
        if (wr) {
          wrMeta = ' | WR: ' + wr.title;
          if (inv.linkedTaskId) {
            const task = (wr.tasks || []).find(t => t.id === inv.linkedTaskId);
            if (task) wrMeta += ` (Task: ${task.title})`;
          } else {
            wrMeta += ' (Entire WR)';
          }
        }
      }
      row.appendChild(el('div', {}, [
        el('div', { class: 'list-item-title', text: inv.invoiceNumber + ' — ' + (client?.name || '—') }),
        el('div', { class: 'list-item-meta', text: formatDate(inv.issueDate) + ' | ' + formatPHP(inv.total) + ' | Paid: ' + formatPHP(paid) + ' | Bal: ' + formatPHP(balance) + wrMeta })
      ]));
      const rightWrap = el('div', { style: 'display:flex; gap:6px; align-items:center; margin-left:auto;' });
      const badgeWrap = el('div', { style: 'display:flex; gap:4px; align-items:center;' });
      badgeWrap.appendChild(this.statusBadge(inv.status));
      if (inv.fromTemplate) badgeWrap.appendChild(this.recurringBadge(inv));
      rightWrap.appendChild(badgeWrap);

      // List actions for Draft invoices (only users with billing:edit)
      if (inv.status === 'Draft' && Auth.can('billing:edit')) {
        const editBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Edit' });
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showForm(inv.id);
        });
        rightWrap.appendChild(editBtn);
        const trashBtn = el('button', { class: 'btn btn-danger btn-sm', text: 'Trash' });
        trashBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.trashInvoice(inv.id);
        });
        rightWrap.appendChild(trashBtn);
      }

      row.appendChild(rightWrap);
      row.addEventListener('click', () => { location.hash = '#billing/detail/' + inv.id; });
      list.appendChild(row);
    });
    container.appendChild(list);
  },

  statusBadge(status) {
    const map = {
      'Draft': 'badge-info',
      'Pending': 'badge-warning',
      'Approved': 'badge-success',
      'Sent': 'badge-warning',
      'Partially Paid': 'badge-warning',
      'Paid': 'badge-success',
      'Overdue': 'badge-danger',
      'Cancelled': 'badge-danger'
    };
    return el('span', { class: 'badge ' + (map[status] || ''), text: this.getInvoiceDisplayStatus(status) });
  },

  recurringBadge(inv) {
    if (!inv.fromTemplate) return el('span');
    return el('span', { class: 'badge badge-recurring', text: 'Recurring' });
  },

  // ============================================================
  // Create / Edit Form
  // ============================================================
  async renderForm(invoiceId = null) {
    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure()
    ]);
    if (!Auth.can('billing:edit')) {
      this.view = 'list';
      App.handleRoute();
      return el('div');
    }

    const entity = Auth.activeEntity;
    const activeId = invoiceId || this.detailId;
    const inv = activeId ? this.getInvoiceById(activeId) : null;
    const opReq = this._prefilledOpReq || null;
    const prefill = this.pendingPrefill || 
                    (this.prefilledWrId ? { workRequestId: this.prefilledWrId, clientId: this.prefilledClientId } : null) || 
                    (opReq ? { workRequestId: opReq.workRequestId || opReq.work_request_id, clientId: opReq.clientId || opReq.client_id, linkedTaskId: opReq.linkedTaskId || opReq.linked_task_id } : null);
    this.pendingPrefill = null; // consume once
    this._prefilledOpReq = null; // consume once
    const container = el('div');

    const form = el('form', { id: 'invoice-form', class: 'form-stacked notion-form' });

    // ── Top property grid ──
    const propsGrid = el('div', { class: 'notion-property-grid' });

    // Client
    const clientGroup = el('div', { class: 'notion-prop' });
    clientGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Client' }));
    const clientSelAttrs = { name: 'clientId', required: true, class: 'notion-prop-select' };
    if (prefill) clientSelAttrs.disabled = true;
    const clientSel = el('select', clientSelAttrs);
    clientSel.appendChild(el('option', { value: '', text: '— Select —' }));
    const allClients = window.apiClient.clientCache._clients || [];
    allClients.filter(c => matchesEntity(c.entity, entity)).forEach(c => {
      const opt = el('option', { value: c.id, text: c.name });
      if (inv && inv.clientId === c.id) opt.selected = true;
      else if (!inv && prefill && prefill.clientId === c.id) opt.selected = true;
      clientSel.appendChild(opt);
    });
    clientGroup.appendChild(clientSel);
    if (prefill) clientGroup.appendChild(el('input', { type: 'hidden', name: 'clientId', value: prefill.clientId }));
    propsGrid.appendChild(clientGroup);

    // Work Request link
    const wrGroup = el('div', { class: 'notion-prop' });
    wrGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg> Work Request' }));
    const wrSelAttrs = { name: 'workRequestId', class: 'notion-prop-select' };
    if (prefill) wrSelAttrs.disabled = true;
    const wrSel = el('select', wrSelAttrs);
    wrSel.appendChild(el('option', { value: '', text: '— None —' }));
    const wrs = window.apiClient.workRequestCache._wrs || [];
    wrs.filter(wr => matchesEntity(wr.entity, entity)).forEach(wr => {
      const opt = el('option', { value: wr.id, text: wr.title });
      if (inv && inv.workRequestId === wr.id) opt.selected = true;
      else if (!inv && prefill && prefill.workRequestId === wr.id) opt.selected = true;
      wrSel.appendChild(opt);
    });
    wrGroup.appendChild(wrSel);
    if (prefill && prefill.workRequestId) wrGroup.appendChild(el('input', { type: 'hidden', name: 'workRequestId', value: prefill.workRequestId }));
    propsGrid.appendChild(wrGroup);

    // Task link (Dynamic based on WR)
    const taskGroup = el('div', { class: 'notion-prop' });
    taskGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg> Task' }));
    const taskSelAttrs = { name: 'linkedTaskId', class: 'notion-prop-select' };
    if (prefill && prefill.linkedTaskId) taskSelAttrs.disabled = true;
    const taskSel = el('select', taskSelAttrs);
    taskSel.appendChild(el('option', { value: '', text: '— Whole Project —' }));
    taskGroup.appendChild(taskSel);
    if (prefill && prefill.linkedTaskId) {
      taskGroup.appendChild(el('input', { type: 'hidden', name: 'linkedTaskId', value: prefill.linkedTaskId }));
    }
    propsGrid.appendChild(taskGroup);

    const updateTasks = () => {
      while (taskSel.firstChild) taskSel.removeChild(taskSel.firstChild);
      taskSel.appendChild(el('option', { value: '', text: '— Whole Project —' }));
      const wrId = wrSel.value;
      if (wrId) {
        const wr = window.apiClient.workRequestCache.getById(wrId);
        const tasks = wr?.tasks || [];
        tasks.forEach(t => {
          const opt = el('option', { value: t.id, text: t.title });
          if (inv && inv.linkedTaskId === t.id) opt.selected = true;
          else if (!inv && prefill && prefill.linkedTaskId === t.id) opt.selected = true;
          taskSel.appendChild(opt);
        });
      }
    };
    wrSel.addEventListener('change', updateTasks);
    updateTasks();

    // Issue Date
    const issueDateProp = el('div', { class: 'notion-prop' });
    issueDateProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Issue Date' }));
    issueDateProp.appendChild(el('input', { type: 'date', name: 'issueDate', class: 'notion-prop-input', value: inv ? inv.issueDate : new Date().toISOString().slice(0, 10), required: true }));
    propsGrid.appendChild(issueDateProp);

    // Due Date
    const dueDateProp = el('div', { class: 'notion-prop' });
    dueDateProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Due Date' }));
    dueDateProp.appendChild(el('input', { type: 'date', name: 'dueDate', class: 'notion-prop-input', value: inv ? inv.dueDate : '', required: true }));
    propsGrid.appendChild(dueDateProp);

    // Invoice Number (auto)
    const numProp = el('div', { class: 'notion-prop' });
    numProp.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="4" y1="11" x2="20" y2="11"/></svg> Invoice Number' }));
    const numInput = el('input', { type: 'text', name: 'invoiceNumber', class: 'notion-prop-input', value: inv ? inv.invoiceNumber : '', readonly: true });
    if (!inv) {
      this.nextInvoiceNumber(entity, this.currentListPage || 1).then(n => { numInput.value = n; }).catch(() => {});
    }
    numProp.appendChild(numInput);
    propsGrid.appendChild(numProp);

    form.appendChild(propsGrid);

    // Line Items — Notion-style editable list
    form.appendChild(el('h3', { class: 'notion-section-heading', text: 'Line Items' }));
    const itemsSection = el('div', { class: 'notion-line-items' });
    const itemsList = el('div', { class: 'notion-line-item-list', id: 'line-item-rows' });
    itemsSection.appendChild(itemsList);

    const addItemBtn = el('button', {
      type: 'button',
      class: 'notion-add-line-item',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add line item'
    });
    addItemBtn.addEventListener('click', () => this.addLineItemRow(itemsList));
    itemsSection.appendChild(addItemBtn);
    form.appendChild(itemsSection);

    // Pre-populate existing line items
    if (inv && inv.lineItems) {
      inv.lineItems.forEach(item => this.addLineItemRow(itemsList, item));
    } else if (opReq) {
      this.addLineItemRow(itemsList, {
        type: 'Professional Fee',
        description: opReq.notes || 'Operations Request Billing',
        amount: opReq.amount ? String(opReq.amount) : ''
      });
    } else {
      this.addLineItemRow(itemsList, { type: 'Professional Fee', description: '', amount: '' });
      this.addLineItemRow(itemsList, { type: 'Government Fee', description: '', amount: '' });
    }

    // Totals (no VAT) — Notion-style summary row
    const totals = el('div', { class: 'notion-totals' });
    totals.appendChild(el('div', { class: 'notion-total-row' }, [
      el('span', { text: 'Subtotal' }),
      el('span', { id: 'inv-subtotal', text: '₱0.00' })
    ]));
    totals.appendChild(el('div', { class: 'notion-total-row notion-total-grand' }, [
      el('span', { text: 'Total' }),
      el('span', { id: 'inv-total', text: '₱0.00' })
    ]));
    form.appendChild(totals);

    // Recalculate totals on input changes
    form.addEventListener('input', () => this.recalcTotals(form));

    form.addEventListener('submit', e => { e.preventDefault(); this.submitForm(form).catch(err => console.error('submitForm error', err)); });

    container.appendChild(form);
    this.recalcTotals(form);
    return container;
  },

  addLineItemRow(container, item) {
    const row = el('div', { class: 'notion-line-item-row' });

    const dragHandle = el('div', {
      class: 'notion-line-item-drag',
      title: 'Drag to reorder',
      html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>'
    });
    row.appendChild(dragHandle);

    const typeSel = el('select', { class: 'item-type notion-line-item-type' });
    ['Professional Fee', 'Government Fee'].forEach(t => {
      const opt = el('option', { value: t, text: t });
      if (item?.type === t) opt.selected = true;
      typeSel.appendChild(opt);
    });
    row.appendChild(typeSel);

    const descIn = el('input', { type: 'text', placeholder: 'Description', class: 'item-desc notion-line-item-desc', value: item?.description || '' });
    row.appendChild(descIn);

    const amtIn = el('input', { type: 'number', placeholder: '0.00', class: 'item-amt notion-line-item-amt', value: item?.amount || '', min: 0, step: 0.01 });
    row.appendChild(amtIn);

    const removeBtn = el('button', {
      type: 'button',
      class: 'notion-line-item-remove',
      title: 'Remove',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    });
    removeBtn.addEventListener('click', () => {
      row.remove();
      const form = container.closest('form');
      if (form) this.recalcTotals(form);
    });
    row.appendChild(removeBtn);

    container.appendChild(row);
  },

  recalcTotals(form) {
    const rows = form.querySelectorAll('.line-item-row');
    let subtotal = 0;
    rows.forEach(row => {
      const amt = parseFloat(row.querySelector('.item-amt').value) || 0;
      subtotal += amt;
    });

    const subEl = form.querySelector('#inv-subtotal');
    const totEl = form.querySelector('#inv-total');
    if (subEl) subEl.textContent = formatPHP(subtotal);
    if (totEl) totEl.textContent = formatPHP(subtotal);
  },

  nextInvoiceNumber(entity, page = 1) {
    return (typeof Utils !== 'undefined' && typeof Utils.nextInvoiceNumber === 'function')
      ? Utils.nextInvoiceNumber(entity, page)
      : Billing._legacyNextInvoiceNumber(entity, page);
  },

  async _legacyNextInvoiceNumber(entity, page = 1) {
    const year = new Date().getFullYear();
    const prefix = entity + '-SI-' + year + '-';
    try {
      // Scan only the current/most-recent page for the latest sequential number.
      const list = await this.fetchInvoices({ page, limit: 1, sortBy: 'createdAt', sortOrder: 'desc' });
      const maxNum = list
        .filter(inv => inv.invoiceNumber && inv.invoiceNumber.startsWith(prefix))
        .reduce((max, inv) => {
          const parts = inv.invoiceNumber.split('-');
          const num = parseInt(parts[parts.length - 1], 10);
          return num > max ? num : max;
        }, 0);
      return prefix + String(maxNum + 1).padStart(3, '0');
    } catch (e) {
      console.error('Failed to compute next invoice number', e);
      return prefix + '001';
    }
  },

  async submitForm(form) {
    if (!validateRequiredFields(form)) return;
    const isResubmitting = typeof PendingChanges !== 'undefined' && PendingChanges.editingPendingId;

    // Validate line items: at least one complete row, no partially-filled rows.
    const itemRows = form.querySelectorAll('.notion-line-item-row');
    let validItemCount = 0;
    let hasPartialItem = false;
    itemRows.forEach(row => {
      const desc = row.querySelector('.item-desc')?.value.trim() || '';
      const amt = parseFloat(row.querySelector('.item-amt')?.value) || 0;
      if (desc && amt > 0) {
        validItemCount++;
      } else if (desc || amt > 0) {
        hasPartialItem = true;
      }
    });
    if (hasPartialItem) {
      Workflow.showMessage('Validation Error', 'Each line item must have both a description and a valid amount greater than zero.', 'warning');
      return;
    }
    if (validItemCount === 0) {
      Workflow.showMessage('Validation Error', 'Please add at least one line item with a description and a valid amount.', 'warning');
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());
    const activeEntity = Auth.activeEntity;
    // Resolve a concrete entity for the optimistic record. The backend resolves the
    // actual entity from the request header / client, but the local cache matching
    // needs a real ATA/LTA code (not 'ALL').
    const clientForEntity = window.apiClient.clientCache.getById(data.clientId);
    const recordEntity = (activeEntity && activeEntity !== 'ALL')
      ? activeEntity
      : (clientForEntity?.entity || Auth.user?.entities?.[0] || 'ATA');

    const rows = form.querySelectorAll('.notion-line-item-row');
    const lineItems = [];
    let subtotal = 0;
    rows.forEach(row => {
      const desc = row.querySelector('.item-desc').value.trim();
      const amt = parseFloat(row.querySelector('.item-amt').value) || 0;
      if (!desc || amt <= 0) return;
      subtotal += amt;
      lineItems.push({
        type: row.querySelector('.item-type').value,
        description: desc,
        amount: amt
      });
    });

    const isNew = !this.detailId;
    const inv = isNew ? null : this.getInvoiceById(this.detailId);

    const record = {
      invoiceNumber: data.invoiceNumber,
      clientId: data.clientId,
      workRequestId: data.workRequestId || null,
      linkedTaskId: data.linkedTaskId || null,
      entity: recordEntity,
      issueDate: data.issueDate,
      dueDate: data.dueDate,
      lineItems,
      subtotal,
      vat: 0,
      total: subtotal,
      status: isNew ? 'Draft' : (inv?.status || 'Draft'),
      payments: inv?.payments || []
    };
    if (inv) {
      // Preserve fields not in form
      record.id = inv.id;
      record.status = inv.status;
      record.payments = inv.payments || [];
      record.paidAmount = inv.paidAmount || 0;
      record.createdBy = inv.createdBy || Auth.user.id;
      record.createdAt = inv.createdAt;
    } else {
      record.createdBy = Auth.user.id;
    }

    if (!isNew) {
      record.id = this.detailId;
    }

    const apiPayload = this.toApiInvoice(record);
    const isApprover = Auth.canBypassReview('invoices');
    const requiresApproval = !isApprover;
    const targetRoute = isResubmitting ? '#admin' : '#billing';

    let result = { approved: true };
    let serverRecord = null;
    let skipGeneration = 0;

    if (isNew) {
      // Optimistic create: show the confirmation modal first, then persist the
      // server record once the API responds.
      const optimisticId = 'temp-inv-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const client = window.apiClient.clientCache.getById(data.clientId);
      const optimisticRecord = {
        ...record,
        id: optimisticId,
        status: 'Draft',
        archived: false,
        paidAmount: 0,
        balance: subtotal,
        fromTemplate: false,
        clientName: client?.name || null,
        createdBy: Auth.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this._detailCache[optimisticId] = optimisticRecord;
      this._detailCacheEntity = activeEntity;
      this._addToListCache(optimisticRecord, { prepend: true });
      this._updateCounts(1, 0);
      skipGeneration = this._beginSkipGeneration();

      const wrName = data.workRequestId ? (window.apiClient.workRequestCache.getById(data.workRequestId)?.title || '') : '';
      const linkMsg = wrName ? ' Linked to "' + wrName + '".' : '';
      const msgConfig = {
        title: 'Invoice Created',
        message: 'Invoice ' + (record.invoiceNumber || '') + ' has been created successfully.' + linkMsg,
        type: 'success'
      };
      await closeFormPanelAndRoute(targetRoute, msgConfig);

      try {
        const res = await window.apiClient.invoices.create(apiPayload);
        serverRecord = this.normalizeInvoice(res.data);
      } catch (e) {
        console.error('Failed to create invoice', e);
        delete this._detailCache[optimisticId];
        this._removeFromListCache(optimisticId);
        this._updateCounts(-1, 0);
        this._endSkipGeneration(skipGeneration);
        App.handleRoute();
        Workflow.showMessage('Error', e.message || 'Unable to create invoice.', 'error');
        return;
      }

      if (serverRecord) {
        this._detailCache[serverRecord.id] = serverRecord;
        this._detailCacheEntity = activeEntity;
        delete this._detailCache[optimisticId];
        this._replaceInListCache(optimisticId, serverRecord);
        this._updateCounts(0, 0);
      }
    } else {
      try {
        if (record.status === 'Draft' || !requiresApproval) {
          const res = await window.apiClient.invoices.update(record.id, apiPayload);
          record.updatedAt = res.data.updated_at || res.data.updatedAt;
          record.status = res.data.status;
          serverRecord = record;
        } else {
          result = await PendingChanges.submit('invoices', record, false);
          if (result.approved) {
            const res = await window.apiClient.invoices.update(record.id, apiPayload);
            record.updatedAt = res.data.updated_at || res.data.updatedAt;
            record.status = res.data.status;
            serverRecord = record;
          }
        }
      } catch (e) {
        console.error('Failed to save invoice', e);
        Workflow.showMessage('Save Failed', e.message || 'Unable to save invoice.', 'error');
        return;
      }

      if (serverRecord) {
        this._detailCache[serverRecord.id] = serverRecord;
        this._detailCacheEntity = activeEntity;
        this._addToListCache(serverRecord);
      }
    }

    // Fulfill pending operations request if any
    try {
      let reqId = this.prefilledRequestId || null;
      if (!reqId && data.workRequestId) {
        const opReqRes = await window.apiClient.operationsRequests.list({ status: 'pending', type: 'billing', workRequestId: data.workRequestId, limit: 1 });
        reqId = (opReqRes.data || [])[0]?.id || null;
      }
      if (reqId) {
        await window.apiClient.operationsRequests.update(reqId, {
          status: 'fulfilled',
          fulfilledBy: Auth.user.id,
          fulfilledAt: new Date().toISOString(),
          linkedRecordId: serverRecord ? serverRecord.id : null
        });
      }
    } catch (e) {
      console.error('Failed to fulfill billing operations request', e);
    }
    this.prefilledRequestId = null;
    this.prefilledWrId = null;
    this.prefilledClientId = null;

    if (isNew) {
      this._invalidateRelatedCaches(serverRecord);
      this._endSkipGeneration(skipGeneration);
      App.handleRoute();
    } else {
      const isApproved = result ? result.approved : true;
      const wrName = data.workRequestId ? (window.apiClient.workRequestCache.getById(data.workRequestId)?.title || '') : '';
      const linkMsg = wrName ? ' Linked to "' + wrName + '".' : '';
      const msgConfig = {
        title: 'Invoice ' + (isNew ? 'Created' : 'Updated'),
        message: isApproved
          ? 'Invoice ' + (serverRecord?.invoiceNumber || record.invoiceNumber) + ' has been ' + (isNew ? 'created' : 'updated') + ' successfully.' + linkMsg
          : 'Invoice ' + record.invoiceNumber + ' ' + (isNew ? 'creation' : 'update') + ' request has been submitted for Admin approval.',
        type: 'success'
      };
      closeFormPanelAndRoute(targetRoute, msgConfig);
    }
  },

  async showForm(invoiceId = null, mode = null) {
    this.detailId = invoiceId;
    await this._loadPrefilledOpReq();
    const isNew = !invoiceId;
    const inv = isNew ? null : this.getInvoiceById(invoiceId);
    const fullPageRoute = isNew ? '#billing/form/new' : `#billing/form/${invoiceId}`;

    // If the user (or stored preference) requests full-page/new-tab, openFormPanel will
    // navigate directly via the route. For side/center peek we render inside the panel.
    openFormPanel({
      icon: '🧾',
      title: isNew ? 'Create Sales Invoice' : `Edit Invoice ${inv?.invoiceNumber || ''}`.trim(),
      formContent: await this.renderForm(invoiceId),
      formId: 'invoice-form',
      mode,
      viewContext: 'invoice-form',
      fullPageRoute,
      newTabRoute: fullPageRoute,
      actions: [
        { text: isNew ? 'Save Invoice' : 'Save Changes', class: 'btn btn-primary', type: 'submit', form: 'invoice-form' },
        { text: 'Cancel', class: 'btn btn-secondary', onClick: () => closeFormPanelAndRoute('#billing') }
      ]
    });
  },

  async showRequestInvoiceModal() {
    await Promise.all([
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure()
    ]);
    const entity = Auth.activeEntity;
    const allWrs = window.apiClient.workRequestCache._wrs || [];
    const wrs = allWrs.filter(wr => {
      const wrEnt = (wr.entity || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(wrEnt);
      return wrEnt === entity.toUpperCase();
    });

    let pendingBillingRequests = [];
    try {
      const pendingRes = await window.apiClient.operationsRequests.list({ status: 'pending', type: 'billing' });
      pendingBillingRequests = pendingRes.data || [];
    } catch (e) {
      console.error('Failed to load pending billing requests', e);
    }
    const pendingWrIds = new Set(pendingBillingRequests.map(r => r.work_request_id || r.workRequestId).filter(Boolean));

    const wrapper = el('div', { style: 'display: flex; flex-direction: column; gap: var(--spacing-md); min-width: 420px; max-width: 500px;' });
    const form = el('form', { class: 'form-stacked' });

    // 1. Select Work Request
    const wrGroup = el('div', { class: 'form-group' });
    wrGroup.appendChild(el('label', { text: 'Select Work Request *' }));
    const wrSelect = el('select', { name: 'workRequestId', class: 'form-select', required: true });
    wrSelect.appendChild(el('option', { value: '', text: '— Select Work Request —' }));
    wrs.forEach(wr => {
      const client = window.apiClient.clientCache.getById(wr.clientId);
      if (!pendingWrIds.has(wr.id)) {
        wrSelect.appendChild(el('option', { value: wr.id, text: `${wr.title} — ${client?.name || '—'}` }));
      }
    });
    wrGroup.appendChild(wrSelect);
    form.appendChild(wrGroup);

    // 2. Link to Specific Task (dynamic select)
    const taskGroup = el('div', { class: 'form-group' });
    taskGroup.appendChild(el('label', { text: 'Link to Specific Task' }));
    const taskSelect = el('select', { name: 'linkedTaskId', class: 'form-select' });
    taskSelect.appendChild(el('option', { value: '', text: '— Whole Project —' }));
    taskGroup.appendChild(taskSelect);
    form.appendChild(taskGroup);

    const updateTasks = () => {
      while (taskSelect.firstChild) taskSelect.removeChild(taskSelect.firstChild);
      taskSelect.appendChild(el('option', { value: '', text: '— Whole Project —' }));
      const wrId = wrSelect.value;
      if (wrId) {
        const wr = window.apiClient.workRequestCache.getById(wrId);
        const tasks = wr?.tasks || [];
        tasks.forEach(t => {
          taskSelect.appendChild(el('option', { value: t.id, text: t.title }));
        });
      }
    };
    wrSelect.addEventListener('change', updateTasks);

    // 3. Billing Amount
    const amtGroup = el('div', { class: 'form-group' });
    amtGroup.appendChild(el('label', { text: 'Billing Amount (₱) *' }));
    const amtIn = el('input', { type: 'text', inputmode: 'decimal', name: 'amount', placeholder: '0.00', required: true });
    amtIn.addEventListener('input', () => { amtIn.value = amtIn.value.replace(/[^0-9.,]/g, ''); });
    amtIn.addEventListener('focus', () => { const n = parseFloat(String(amtIn.value).replace(/[₱$,\s]/g, '')) || 0; amtIn.value = n > 0 ? String(n) : ''; });
    amtIn.addEventListener('blur', () => { const n = parseFloat(String(amtIn.value).replace(/[₱$,\s]/g, '')) || 0; amtIn.value = n > 0 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; });
    amtGroup.appendChild(amtIn);
    form.appendChild(amtGroup);

    // 4. Attachment / Proof
    const fileGroup = el('div', { class: 'form-group' });
    fileGroup.appendChild(el('label', { text: 'Proof of Completion (optional)' }));
    const fileIn = el('input', { type: 'file', name: 'receipt' });
    fileGroup.appendChild(fileIn);
    form.appendChild(fileGroup);

    // 5. Notes
    const notesGroup = el('div', { class: 'form-group' });
    notesGroup.appendChild(el('label', { text: 'Billing Notes (Optional)' }));
    const notesArea = el('textarea', { name: 'notes', class: 'form-control', style: 'min-height: 80px;', placeholder: 'e.g. Requesting milestone Downpayment billing...' });
    notesGroup.appendChild(notesArea);
    form.appendChild(notesGroup);

    // Footer actions
    const footer = el('div', { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: var(--spacing-md); border-top: 1px solid var(--color-border); padding-top: var(--spacing-sm);' }, [
      el('button', { id: 'btn-cancel-opreq', class: 'btn btn-ghost', type: 'button', text: 'Cancel' }),
      el('button', { id: 'btn-save-opreq', class: 'btn btn-primary', type: 'submit', text: 'Submit Request' })
    ]);
    form.appendChild(footer);
    wrapper.appendChild(form);

    const overlay = Workflow.showModal('Request Invoice from Accounting', wrapper);

    overlay.querySelector('#btn-cancel-opreq').addEventListener('click', () => overlay.remove());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const wrId = wrSelect.value;
      if (!wrId) {
        Workflow.showMessage('Validation Error', 'Please select a work request.', 'warning');
        return;
      }
      const wr = window.apiClient.workRequestCache.getById(wrId);

      const amtStr = amtIn.value;
      const amount = parseFloat(amtStr.replace(/[₱$,\s]/g, '')) || 0;
      if (amount <= 0) {
        Workflow.showMessage('Validation Error', 'Please enter a valid billing amount.', 'warning');
        return;
      }

      const linkedTaskId = taskSelect.value;
      const notes = notesArea.value.trim();
      const receiptFile = fileIn.files?.[0];

      const record = {
        type: 'billing',
        workRequestId: wrId,
        clientId: wr?.clientId || null,
        amount: amount,
        notes: notes
      };

      try {
        await window.apiClient.operationsRequests.create(record);
        overlay.remove();
        Workflow.showMessage(
          'Request Submitted',
          'Your invoice request has been submitted to Accounting for review.',
          'success'
        );
      } catch (err) {
        console.error('Failed to create billing request', err);
        Workflow.showMessage('Request Failed', err.message || 'Unable to submit billing request.', 'error');
        return;
      }

      App.handleRoute();
    });
  },

  // ============================================================
  // Detail View (with payment recording)
  // ============================================================
  renderDetail() {
    const inv = this.getInvoiceById(this.detailId);
    if (!inv) { location.hash = '#billing'; return el('div'); }
    const client = window.apiClient.clientCache.getById(inv.clientId);

    const container = el('div', { class: 'invoice-detail' });

    // Status and badges
    const statusWrap = el('div', { style: 'display:flex; gap:8px; align-items:center; margin-bottom: var(--spacing-lg);' });
    statusWrap.appendChild(this.statusBadge(inv.status));
    if (inv.fromTemplate) statusWrap.appendChild(this.recurringBadge(inv));
    container.appendChild(statusWrap);

    if (inv.status === 'Draft' && inv.rejectionReason) {
      const rejBanner = el('div', {
        class: 'alert-banner alert-danger',
        style: 'background: var(--color-bg-muted); border: 1px solid var(--color-danger); color: var(--color-danger); padding: 12px 16px; border-radius: 12px; margin-bottom: 20px; font-size: 0.875rem; display: flex; align-items: center; gap: 8px;'
      });
      rejBanner.appendChild(el('span', { html: '❌' }));
      rejBanner.appendChild(el('span', { html: `<strong>Rejection Reason:</strong> ${inv.rejectionReason}` }));
      container.appendChild(rejBanner);
    }

    if (inv.status === 'Pending') {
      const banner = el('div', {
        class: 'alert-banner alert-warning',
        style: 'background: var(--color-bg-muted); border: 1px solid var(--color-warning); color: var(--color-warning); padding: 12px 16px; border-radius: 12px; margin-bottom: 20px; font-size: 0.875rem; display: flex; align-items: center; gap: 8px;'
      });
      banner.appendChild(el('span', { html: '⚠️' }));
      banner.appendChild(el('span', { text: 'This invoice is pending administrative approval and cannot be printed, sent, or have payments recorded until approved.' }));
      container.appendChild(banner);
    }

    const meta = el('div', { class: 'invoice-meta' });
    meta.appendChild(el('p', { text: 'Client: ' + (client?.name || '—') }));
    meta.appendChild(el('p', { text: 'Issue Date: ' + formatDate(inv.issueDate) }));
    meta.appendChild(el('p', { text: 'Due Date: ' + formatDate(inv.dueDate) }));
    container.appendChild(meta);

    // Linked Work Request / Task info card
    if (inv.workRequestId) {
      const linkedWr = window.apiClient.workRequestCache.getById(inv.workRequestId);
      if (linkedWr) {
        const linkCard = el('div', {
          style: 'background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius: 12px;padding:12px 16px;margin-bottom:var(--spacing-md);font-size:0.8125rem;'
        });
        const linkHeader = el('div', {
          style: 'display:flex;align-items:center;gap:6px;margin-bottom:6px;color:#1e40af;font-weight:600;'
        });
        linkHeader.appendChild(el('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>' }));
        linkHeader.appendChild(el('span', { text: 'Linked Work Request' }));
        linkCard.appendChild(linkHeader);

        const wrLink = el('a', {
          href: 'javascript:void(0)',
          text: linkedWr.title,
          style: 'color:#2563eb;font-weight:500;text-decoration:none;'
        });
        wrLink.addEventListener('click', () => {
          location.hash = '#operations/detail/' + linkedWr.id;
        });
        wrLink.addEventListener('mouseenter', () => { wrLink.style.textDecoration = 'underline'; });
        wrLink.addEventListener('mouseleave', () => { wrLink.style.textDecoration = 'none'; });
        linkCard.appendChild(wrLink);

        if (inv.linkedTaskId) {
          const linkedTask = (linkedWr.tasks || []).find(t => t.id === inv.linkedTaskId);
          if (linkedTask) {
            linkCard.appendChild(el('div', {
              text: '↳ Scope: Task — ' + linkedTask.title,
              style: 'margin-top:4px;color:#64748b;font-size:0.75rem;'
            }));
          }
        } else {
          linkCard.appendChild(el('div', {
            text: '↳ Scope: Entire Work Request / Project',
            style: 'margin-top:4px;color:#64748b;font-size:0.75rem;'
          }));
        }

        // Show WR phase status
        linkCard.appendChild(el('div', {
          text: 'Status: ' + (linkedWr.status || '—'),
          style: 'margin-top:4px;color:#64748b;font-size:0.75rem;'
        }));
        container.appendChild(linkCard);
      }
    }

    // Line items table
    const table = el('table', { class: 'data-table' });
    const thead = el('thead');
    const thr = el('tr');
    ['Type', 'Description', 'Amount'].forEach(h => thr.appendChild(el('th', { text: h })));
    thead.appendChild(thr);
    table.appendChild(thead);
    const tbody = el('tbody');
    inv.lineItems.forEach(item => {
      const tr = el('tr');
      tr.appendChild(el('td', { text: item.type }));
      tr.appendChild(el('td', { text: item.description }));
      tr.appendChild(el('td', { text: formatPHP(item.amount) }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    // Totals
    const subtotal = this.getSubtotal(inv);
    const paid = this.getPaidAmount(inv);
    const totals = el('div', { class: 'invoice-totals' });
    totals.appendChild(el('div', { class: 'total-row total-grand' }, [el('span', { text: 'Total:' }), el('span', { text: formatPHP(inv.total) })]));
    totals.appendChild(el('div', { class: 'total-row' }, [el('span', { text: 'Paid:' }), el('span', { text: formatPHP(paid) })]));
    totals.appendChild(el('div', { class: 'total-row' }, [el('span', { text: 'Balance:' }), el('span', { text: formatPHP(inv.total - paid) })]));
    container.appendChild(totals);

    // Payments history
    if (Array.isArray(inv.payments) && inv.payments.length > 0) {
      const payHist = el('div', { class: 'form-section', style: 'overflow-x:auto;' });
      payHist.appendChild(el('h3', { text: 'Payment Details' }));
      inv.payments.forEach(p => {
        const pCard = el('div', { class: 'card', style: 'margin-bottom:12px; padding:16px; border:1px solid #e2e8f0; border-radius: 12px;' });

        // Header row: amount left, method icon right
        const header = el('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;' });
        const amtBlock = el('div');
        amtBlock.appendChild(el('span', { text: formatPHP(p.amount), style: 'display:block; font-weight:700; font-size:1.25rem; color:#1e293b; line-height:1.2;' }));
        amtBlock.appendChild(el('span', { text: formatDate(p.date), style: 'display:block; font-size:0.75rem; color:#94a3b8; margin-top:2px;' }));
        header.appendChild(amtBlock);
        header.appendChild(this.methodIcon(p.method));
        pCard.appendChild(header);

        // Divider
        pCard.appendChild(el('div', { style: 'height:1px; background:#e2e8f0; margin:0 0 12px;' }));

        // Payment metadata rows (label : value pairs)
        const rows = el('div', { style: 'display:flex; flex-direction:column; gap:6px;' });

        const addRow = (label, value) => {
          if (!value) return;
          const row = el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline; font-size:0.8125rem;' });
          row.appendChild(el('span', { text: label, style: 'color:#94a3b8; font-weight:500;' }));
          row.appendChild(el('span', { text: value, style: 'color:#334155; font-weight:600; text-align:right;' }));
          rows.appendChild(row);
        };

        if (p.reference) addRow('Reference', p.reference);
        if (p.checkNumber) addRow('Check Number', p.checkNumber);
        if (p.bankName) addRow('Bank', p.bankName);
        if (p.bankAccount) addRow('Account Number', p.bankAccount);
        if (p.transactionId) addRow('Transaction ID', p.transactionId);
        if (p.digitalAccount) addRow('Wallet / Account', p.digitalAccount);
        if (p.cardLast4) addRow('Card Number', '**** ' + p.cardLast4);

        const recorder = p.recordedBy ? window.apiClient.userCache.getById(p.recordedBy) : null;
        const collector = p.collectedBy ? window.apiClient.userCache.getById(p.collectedBy) : null;
        addRow('Recorded By', recorder ? recorder.name : '—');
        addRow('Collected By', collector ? collector.name : '—');

        pCard.appendChild(rows);

        if (p.notes) {
          pCard.appendChild(el('div', { style: 'height:1px; background:#e2e8f0; margin:12px 0;' }));
          pCard.appendChild(el('div', { text: p.notes, style: 'font-size:0.8125rem; color:#64748b; font-style:italic; line-height:1.4;' }));
        }
        payHist.appendChild(pCard);
      });
      container.appendChild(payHist);
    }

    // Payment recording — billing:edit (Accounting/Admin) or billing:mark_paid (Manager)
    const canRecordPayment = Auth.can('billing:edit') || Auth.can('billing:mark_paid');
    if (canRecordPayment && inv.status !== 'Paid' && inv.status !== 'Cancelled' && inv.status !== 'Pending') {
      const paySection = el('div', { class: 'form-section' });
      paySection.appendChild(el('h3', { text: 'Record Payment' }));
      const payForm = el('form', { class: 'form-stacked' });

      // Amount and Date (always shown)
      payForm.appendChild(el('div', { class: 'form-group' }, [
        el('label', { text: 'Amount Paid *' }),
        el('input', { type: 'number', name: 'payAmount', min: 0, step: 0.01, required: true, placeholder: `Balance remaining: ${formatPHP(inv.total - paid)}` })
      ]));
      payForm.appendChild(el('div', { class: 'form-group' }, [
        el('label', { text: 'Payment Date *' }),
        el('input', { type: 'date', name: 'payDate', value: new Date().toISOString().slice(0, 10), required: true })
      ]));

      // Payment Method
      const methodGroup = el('div', { class: 'form-group' });
      methodGroup.appendChild(el('label', { text: 'Payment Method *' }));
      const methodSel = el('select', { name: 'payMethod', required: true });
      const methods = [
        { value: '', text: '— Select Method —' },
        { value: 'Cash', text: 'Cash' },
        { value: 'Check', text: 'Check' },
        { value: 'Bank Transfer', text: 'Bank Transfer (Wire / Deposit)' },
        { value: 'GCash', text: 'GCash' },
        { value: 'Maya', text: 'Maya' },
        { value: 'Credit Card', text: 'Credit Card' },
        { value: 'Debit Card', text: 'Debit Card' },
        { value: 'PayPal', text: 'PayPal' },
        { value: 'Other Digital', text: 'Other Digital Wallet / Platform' }
      ];
      methods.forEach(m => methodSel.appendChild(el('option', { value: m.value, text: m.text })));
      methodGroup.appendChild(methodSel);
      payForm.appendChild(methodGroup);

      // Conditional field groups
      const createFieldGroup = (name, label, type = 'text', placeholder = '') =>
        el('div', { class: 'form-group pay-field-group', 'data-method': name, style: 'display:none;' }, [
          el('label', { text: label }),
          el('input', { type, name, placeholder })
        ]);

      const checkFields = el('div', { class: 'pay-check-fields', style: 'display:none;' });
      checkFields.appendChild(createFieldGroup('checkNumber', 'Check Number *', 'text', 'e.g., 0001234'));
      checkFields.appendChild(createFieldGroup('bankName', 'Bank Name *', 'text', 'e.g., BDO, BPI, Metrobank'));
      payForm.appendChild(checkFields);

      const bankFields = el('div', { class: 'pay-bank-fields', style: 'display:none;' });
      bankFields.appendChild(createFieldGroup('bankName', 'Bank Name *', 'text', 'e.g., BDO, BPI'));
      bankFields.appendChild(createFieldGroup('bankAccount', 'Bank Account Number', 'text', 'e.g., 1234-5678-9012'));
      bankFields.appendChild(createFieldGroup('transactionId', 'Transaction / Reference ID *', 'text', 'e.g., REF-2025-001'));
      payForm.appendChild(bankFields);

      const digitalFields = el('div', { class: 'pay-digital-fields', style: 'display:none;' });
      digitalFields.appendChild(createFieldGroup('transactionId', 'Transaction / Reference ID *', 'text', 'e.g., GCASH-REF-001'));
      digitalFields.appendChild(createFieldGroup('digitalAccount', 'Wallet / Account Number', 'text', 'e.g., 0917-123-4567'));
      payForm.appendChild(digitalFields);

      const cardFields = el('div', { class: 'pay-card-fields', style: 'display:none;' });
      cardFields.appendChild(createFieldGroup('cardLast4', 'Card Last 4 Digits', 'text', 'e.g., 1234'));
      cardFields.appendChild(createFieldGroup('transactionId', 'Authorization / Reference Code *', 'text', 'e.g., AUTH-XXXXXX'));
      cardFields.appendChild(createFieldGroup('bankName', 'Card Issuer / Bank', 'text', 'e.g., BDO, Metrobank'));
      payForm.appendChild(cardFields);

      // Toggle conditional fields
      methodSel.addEventListener('change', () => {
        const m = methodSel.value;
        checkFields.style.display = m === 'Check' ? 'block' : 'none';
        bankFields.style.display = m === 'Bank Transfer' ? 'block' : 'none';
        digitalFields.style.display = ['GCash','Maya','PayPal','Other Digital'].includes(m) ? 'block' : 'none';
        cardFields.style.display = ['Credit Card','Debit Card'].includes(m) ? 'block' : 'none';
      });

      // Reference / common fields
      payForm.appendChild(el('div', { class: 'form-group' }, [
        el('label', { text: 'General Reference / Receipt No.' }),
        el('input', { type: 'text', name: 'payRef', placeholder: 'Any additional reference number' })
      ]));

      payForm.appendChild(el('div', { class: 'form-group' }, [
        el('label', { text: 'Payment Notes' }),
        el('textarea', { name: 'payNotes', rows: 2, placeholder: 'e.g., Partial payment, installment #1, etc.' })
      ]));

      const collectorGroup = el('div', { class: 'form-group' });
      collectorGroup.appendChild(el('label', { text: 'Payment Collected By' }));
      const collectorSel = el('select', { name: 'payCollectedBy' });
      collectorSel.appendChild(el('option', { value: '', text: '— Select User —' }));
      (window.apiClient.userCache._users || []).forEach(u => {
        const opt = el('option', { value: u.id, text: u.name });
        collectorSel.appendChild(opt);
      });
      collectorGroup.appendChild(collectorSel);
      payForm.appendChild(collectorGroup);

      const payBtn = el('button', { type: 'submit', class: 'btn btn-success', text: 'Record Payment' });
      payForm.appendChild(payBtn);
      payForm.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(payForm);
        const method = fd.get('payMethod');
        const payAmount = parseFloat(fd.get('payAmount')) || 0;

        // Build payment record with method-specific details
        const paymentRecord = {
          amount: payAmount,
          date: fd.get('payDate'),
          method,
          reference: fd.get('payRef') || '',
          recordedBy: Auth.user.id,
          collectedBy: fd.get('payCollectedBy') || '',
          notes: fd.get('payNotes') || '',
          recordedAt: new Date().toISOString()
        };

        // Add method-specific fields
        if (method === 'Check') {
          paymentRecord.checkNumber = fd.get('checkNumber') || '';
          paymentRecord.bankName = fd.get('bankName') || '';
        }
        if (method === 'Bank Transfer') {
          paymentRecord.bankName = fd.get('bankName') || '';
          paymentRecord.bankAccount = fd.get('bankAccount') || '';
          paymentRecord.transactionId = fd.get('transactionId') || '';
        }
        if (['GCash','Maya','PayPal','Other Digital'].includes(method)) {
          paymentRecord.transactionId = fd.get('transactionId') || '';
          paymentRecord.digitalAccount = fd.get('digitalAccount') || '';
        }
        if (['Credit Card','Debit Card'].includes(method)) {
          paymentRecord.cardLast4 = fd.get('cardLast4') || '';
          paymentRecord.transactionId = fd.get('transactionId') || '';
          paymentRecord.bankName = fd.get('bankName') || '';
        }

        const payments = inv.payments || [];
        payments.push(paymentRecord);
        const newPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        let newStatus = inv.status;
        if (newPaid >= inv.total) newStatus = 'Paid';
        else if (newPaid > 0 && newPaid < inv.total) newStatus = 'Partially Paid';

        try {
          await window.apiClient.invoices.recordPayment(inv.id, {
            amount: payAmount,
            method,
            reference: paymentRecord.reference,
            date: paymentRecord.date,
            notes: paymentRecord.notes,
          });
          // Refresh invoice from server so totals/status reflect DB state
          const refreshed = await window.apiClient.invoices.get(inv.id);
          this._detailCache[inv.id] = this.normalizeInvoice(refreshed.data);
        } catch (e) {
          console.error('Failed to record payment', e);
          Workflow.showMessage('Payment Failed', e.message || 'Unable to record payment.', 'error');
          return;
        }
        App.handleRoute();
      });
      paySection.appendChild(payForm);
      container.appendChild(paySection);
    }

    // BIR compliance footer (visible only in print via CSS)
    const birFooter = el('div', { class: 'bir-footer', style: 'margin-top:40px; padding-top:20px; border-top:2px solid var(--color-border); display:none;' });
    birFooter.appendChild(el('p', { style: 'font-size:0.75rem; color:var(--color-text-muted); text-align:center;', text: 'This document is not valid for claim of input tax.' }));
    container.appendChild(birFooter);

    // Status actions
    const actions = el('div', { class: 'form-actions' });
    const canApprove = Auth.can('billing:approve');
    const canEdit = Auth.can('billing:edit');
    
    
    if (inv.status === 'Draft') {
      // Edit & Trash — only billing:edit (Admin, Accounting)
      if (canEdit) {
        const editBtn = el('button', { class: 'btn btn-secondary', text: 'Edit Invoice', style: 'margin-right:8px;' });
        editBtn.addEventListener('click', () => {
          this.showForm(inv.id);
        });
        actions.appendChild(editBtn);

        const trashBtn = el('button', { class: 'btn btn-danger', text: 'Trash', style: 'margin-right:8px;' });
        trashBtn.addEventListener('click', () => {
          this.trashInvoice(inv.id);
        });
        actions.appendChild(trashBtn);
      }

      // Approve — only billing:approve (Admin)
      if (canApprove) {
        const approveBtn = el('button', { class: 'btn btn-success', text: 'Approve' });
        approveBtn.addEventListener('click', async () => {
          try {
            const res = await window.apiClient.invoices.update(inv.id, { status: 'Approved' });
            this._detailCache[inv.id] = this.normalizeInvoice(res.data);
          } catch (e) {
            console.error('Failed to approve invoice', e);
            Workflow.showMessage('Approval Failed', e.message || 'Unable to approve invoice.', 'error');
            return;
          }
          App.handleRoute();
        });
        actions.appendChild(approveBtn);
      } else if (canEdit) {
        // Send for Approval — billing:edit without billing:approve (Accounting)
        const sendBtn = el('button', { class: 'btn btn-primary', text: 'Send for Approval' });
        sendBtn.addEventListener('click', async () => {
          try {
            const res = await window.apiClient.invoices.update(inv.id, { status: 'Pending' });
            this._detailCache[inv.id] = this.normalizeInvoice(res.data);
            PendingChanges.submit('invoices', { ...inv, status: 'Approved' }, false);
          } catch (e) {
            console.error('Failed to submit invoice for approval', e);
            Workflow.showMessage('Submit Failed', e.message || 'Unable to submit invoice.', 'error');
            return;
          }
          Workflow.showMessage('Submitted', 'Invoice has been sent for administrative approval.', 'success');
          App.handleRoute();
        });
        actions.appendChild(sendBtn);
      }
    } else if (inv.status === 'Approved' && canEdit) {
      // Mark as Released — billing:edit (Accounting), pending Admin approval
      const canReleaseDirectly = Auth.user?.role === 'Admin' || Auth.isManagerial() || Auth.can('billing:release');
      const sentBtn = el('button', { class: 'btn btn-primary', text: canReleaseDirectly ? 'Release Invoice' : 'Submit for Release' });
      sentBtn.addEventListener('click', async () => {
        try {
          const targetStatus = isAdmin ? 'Sent' : 'Release Pending Approval';
          const res = await window.apiClient.invoices.update(inv.id, { status: targetStatus });
          this._detailCache[inv.id] = this.normalizeInvoice(res.data);
          if (!isAdmin) Workflow.showMessage('Submitted', 'Invoice release has been submitted for administrative approval.', 'success');
        } catch (e) {
          console.error('Failed to update invoice status', e);
          Workflow.showMessage('Update Failed', e.message || 'Unable to update invoice status.', 'error');
          return;
        }
        App.handleRoute();
      });
      actions.appendChild(sentBtn);
    } else if (inv.status === 'Paid' && !inv.archived) {
      const archiveBtn = el('button', { class: 'btn btn-primary', text: 'Archive Invoice', style: 'margin-right:8px;' });
      archiveBtn.addEventListener('click', () => this.archiveInvoice(inv.id));
      actions.appendChild(archiveBtn);
    }
    container.appendChild(actions);

    return container;
  },

  generateInvoice(inv, noLogo = false) {
    const client = window.apiClient.clientCache.getById(inv.clientId);
    const entity = inv.entity || 'ATA';
    const w = window.open('', '_blank');
    if (!w) return;
    const d = w.document;

    const title = d.createElement('title');
    title.textContent = 'Statement ' + inv.invoiceNumber;
    d.head.appendChild(title);

    const style = d.createElement('style');
    style.textContent = `
      @page { size: A4; margin: 15mm 20mm; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #000; max-width: 210mm; margin: 0 auto; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      
      /* Generic Header Styles */
      .generic-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 5px;
      }
      .generic-company-name {
        font-size: 15pt;
        font-weight: 800;
        color: #000;
        letter-spacing: 0.5px;
        font-family: 'Segoe UI', Arial, sans-serif;
      }
      .generic-title {
        font-size: 24pt;
        font-weight: 800;
        letter-spacing: 2px;
        color: #000;
      }
      .generic-header-divider {
        border-bottom: 2px solid #000;
        margin-bottom: 20px;
      }

      /* ATA Header Styles */
      .header-container-ata {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 5px;
      }
      .logo-area-ata {
        display: flex;
        align-items: center;
        background: linear-gradient(90deg, #e0f2fe 0%, #e0f2fe 80%, transparent 100%);
        padding: 6px 20px 6px 6px;
        border-radius: 40px 0 0 40px;
        width: 70%;
      }
      .logo-oval-ata {
        width: 110px;
        height: 65px;
        background-color: #00A3E0;
        border-radius: 50% / 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: hidden;
        margin-right: 15px;
      }
      .logo-oval-ata img {
        width: 90%;
        height: 90%;
        object-fit: contain;
      }
      .company-name-ata {
        font-size: 15pt;
        font-weight: 800;
        color: #002D62;
        letter-spacing: 0.5px;
        font-family: 'Arial Black', sans-serif;
      }
      .statement-title-ata {
        font-size: 24pt;
        font-weight: 800;
        letter-spacing: 2px;
        color: #000;
      }
      .header-divider-ata {
        border-bottom: 2px solid #000;
        margin-bottom: 20px;
      }

      /* LTA Header Styles */
      .header-container-lta {
        display: flex;
        align-items: stretch;
        height: 60px;
        margin-bottom: 20px;
        border-bottom: 2px solid #000;
        padding-bottom: 6px;
      }
      .logo-banner-lta {
        display: flex;
        align-items: center;
        background-color: #007cc0;
        color: white;
        padding: 0 15px;
        flex: 1;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .logo-img-lta {
        height: 40px;
        width: 40px;
        border-radius: 12px;
        background: #fff;
        padding: 2px;
        margin-right: 12px;
        object-fit: contain;
      }
      .company-name-lta {
        font-size: 13pt;
        font-weight: 700;
        letter-spacing: 0.5px;
      }
      .slanted-block-lta {
        background-color: #1e293b;
        color: white;
        display: flex;
        align-items: center;
        padding: 0 20px 0 30px;
        font-size: 13pt;
        font-weight: 700;
        clip-path: polygon(15px 0, 100% 0, 100% 100%, 0 100%);
        margin-left: -15px;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .right-statement-lta {
        display: flex;
        align-items: center;
        padding: 0 15px;
        font-size: 20pt;
        font-weight: 800;
        color: #000;
      }

      /* Common Layout */
      .two-col {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 20px;
      }
      .col-bill-to {
        border: 1.5px solid #000;
        padding: 10px;
        width: 55%;
      }
      .bill-to-title {
        font-size: 10pt;
        font-weight: 700;
        border-bottom: 1px solid #000;
        padding-bottom: 4px;
        margin-bottom: 6px;
        text-transform: uppercase;
      }
      .bill-to-content {
        font-size: 10pt;
        line-height: 1.4;
      }
      .bill-to-content p {
        margin: 2px 0;
      }
      .col-details {
        width: 40%;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
      }
      .details-table {
        border-collapse: collapse;
        border: 1.5px solid #000;
        width: 100%;
      }
      .details-table td {
        border: 1px solid #000;
        padding: 6px 10px;
        font-size: 9pt;
      }
      .details-label {
        font-weight: 700;
        background-color: #f8fafc;
        width: 55%;
      }
      .details-value {
        text-align: right;
        font-family: monospace;
        font-size: 10pt;
      }

      /* Items Table */
      .items-table {
        width: 100%;
        border-collapse: collapse;
        margin: 20px 0;
        border: 1.5px solid #000;
      }
      .items-table th {
        border: 1px solid #000;
        padding: 8px;
        background-color: #f8fafc;
        font-weight: 700;
        font-size: 9pt;
        text-align: left;
        text-transform: uppercase;
      }
      .items-table td {
        border: 1px solid #000;
        padding: 8px;
        font-size: 10pt;
      }
      .items-table .num {
        text-align: right;
        font-family: monospace;
      }

      /* Bottom Layout */
      .bottom-container {
        display: flex;
        justify-content: space-between;
        margin-top: 20px;
        align-items: flex-start;
      }
      .payment-details-box {
        border: 1.5px solid #000;
        padding: 10px;
        width: 45%;
        font-size: 9pt;
      }
      .payment-details-title {
        font-weight: 700;
        margin-bottom: 8px;
      }
      .payment-details-row {
        display: flex;
        margin-bottom: 6px;
        align-items: baseline;
      }
      .payment-details-row span:first-child {
        margin-right: 5px;
        white-space: nowrap;
      }
      .fill-line {
        flex-grow: 1;
        border-bottom: 1px dotted #000;
        min-height: 12px;
        margin-right: 15px;
        padding-bottom: 1px;
      }
      .total-box-container {
        width: 50%;
        display: flex;
        justify-content: flex-end;
      }
      .total-table {
        border-collapse: collapse;
        border: 2px double #000;
        width: 100%;
      }
      .total-table td {
        padding: 10px;
        font-size: 11pt;
        font-weight: 700;
        border: 1px solid #000;
      }
      .total-label {
        background-color: #f8fafc;
        width: 50%;
      }
      .total-currency {
        text-align: center;
        width: 15%;
      }
      .total-value {
        text-align: right;
        width: 35%;
        font-family: monospace;
        font-size: 12pt;
      }

      /* Signatures */
      .signature-row {
        display: flex;
        justify-content: space-between;
        margin-top: 40px;
        gap: 20px;
      }
      .signature-box {
        width: 30%;
        display: flex;
        flex-direction: column;
      }
      .signature-label {
        font-size: 10pt;
        font-weight: 700;
        margin-bottom: 40px;
      }
      .signature-line-container {
        border-top: 1.5px solid #000;
        padding-top: 4px;
        text-align: center;
      }
      .signature-name-printed {
        font-size: 9pt;
        font-weight: 700;
        text-transform: uppercase;
      }

      /* Payment summary styles */
      .pay-summary {
        margin: 20px 0;
        border: 1.5px solid #cbd5e1;
        border-radius: 12px;
        padding: 15px;
        background-color: #f8fafc;
      }
      .pay-summary h4 {
        margin: 0 0 10px;
        font-size: 10pt;
        text-transform: uppercase;
        color: #475569;
        border-bottom: 1px solid #cbd5e1;
        padding-bottom: 4px;
      }
      .pay-card {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 10px;
        margin-bottom: 8px;
        background: #fff;
        font-size: 9pt;
      }
      .pay-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      /* Footer */
      .footer-container {
        margin-top: 30px;
        text-align: center;
      }
      .thank-you {
        font-size: 11pt;
        font-weight: 700;
        letter-spacing: 1px;
        margin-bottom: 4px;
      }
      .footer-text {
        font-size: 9pt;
        font-weight: bold;
      }
      .footer-text.underline {
        text-decoration: underline;
      }

      .vat-breakdown {
        background: #f8fafc;
        padding: 12px;
        border-radius: 12px;
        margin-top: 12px;
        font-size: 9pt;
        border: 1px solid #cbd5e1;
      }
      .vat-breakdown p {
        margin: 2px 0;
      }
    `;
    d.head.appendChild(style);

    const subtotal = this.getSubtotal(inv);
    const vatAmount = parseFloat(inv.vat) || 0;
    const isVat = vatAmount > 0;
    const paid = this.getPaidAmount(inv);
    const balance = inv.total - paid;
    const hasPayments = Array.isArray(inv.payments) && inv.payments.length > 0;

    let dateVal = '';
    let cashVal = '';
    let checkVal = '';
    let bankVal = '';

    if (hasPayments) {
      const p = inv.payments[0];
      if (p) {
        dateVal = p.date ? formatDate(p.date) : '';
        if (p.method === 'Cash') {
          cashVal = formatPHP(p.amount);
        } else if (p.method === 'Check') {
          checkVal = p.checkNumber || '';
          bankVal = p.bankName || '';
        } else {
          // Digital methods
          cashVal = formatPHP(p.amount);
          checkVal = p.transactionId || p.reference || '';
          bankVal = p.bankName || p.method || '';
        }
      }
    }

    let headerHtml = '';
    if (noLogo) {
      headerHtml = `
        <div class="generic-header">
          <div class="generic-company-name">${entity === 'ATA' ? 'A.T.A. BUSINESS CONSULTANCY' : 'LTA BUSINESS MANAGEMENT CORP'}</div>
          <div class="generic-title">STATEMENT</div>
        </div>
        <div class="generic-header-divider"></div>
      `;
    } else if (entity === 'ATA') {
      headerHtml = `
        <div class="header-container-ata">
          <div style="display: flex; align-items: center;">
            <img src="ERP_Assets/ATA-LOGO.jpg" alt="ATA Logo" style="height: 65px; object-fit: contain; margin-right: 12px;">
            <span class="company-name-ata">A.T.A. BUSINESS CONSULTANCY</span>
          </div>
          <div class="statement-title-ata">STATEMENT</div>
        </div>
        <div class="header-divider-ata"></div>
      `;
    } else {
      headerHtml = `
        <div class="header-container-lta">
          <div class="logo-banner-lta">
            <img src="ERP_Assets/LTA-LOGO.jpg" class="logo-img-lta" alt="LTA Logo">
            <span class="company-name-lta">LTA BUSINESS MANAGEMENT CORP</span>
          </div>
          <div class="slanted-block-lta">STATEMENT</div>
        </div>
      `;
    }

    let tableHeaders = '';
    if (noLogo || entity === 'ATA') {
      tableHeaders = `
        <tr>
          <th style="width: 15%;">DATE</th>
          <th style="width: 65%;">DESCRIPTION</th>
          <th style="width: 20%; text-align: right;">AMOUNT DUE</th>
        </tr>
      `;
    } else {
      tableHeaders = `
        <tr>
          <th style="width: 15%;">DATE</th>
          <th style="width: 55%;">DESCRIPTION</th>
          <th style="width: 10%;"></th>
          <th style="width: 20%; text-align: right;">AMOUNT DUE</th>
        </tr>
      `;
    }

    let balanceForwardRow = '';
    if (noLogo || entity === 'ATA') {
      balanceForwardRow = `
        <tr>
          <td></td>
          <td style="font-weight: bold; text-align: right;">BALANCE FORWARD:</td>
          <td></td>
        </tr>
      `;
    } else {
      balanceForwardRow = `
        <tr>
          <td></td>
          <td style="font-weight: bold; text-align: right;">BALANCE FORWARD:</td>
          <td></td>
          <td></td>
        </tr>
      `;
    }

    const lineItemsHtml = inv.lineItems.map((li, idx) => {
      const qty = parseFloat(li.qty) || 1;
      const unit = parseFloat(li.unitCost || li.amount) || 0;
      const total = qty * unit;
      const dateStr = idx === 0 ? formatDate(inv.issueDate) : '';
      let descStr = escapeHtml(li.description || '—');
      if (qty > 1) {
        descStr += ` (Qty: ${qty} x ${formatPHP(unit)})`;
      }
      if (li.type) {
        descStr = `[${escapeHtml(li.type)}] ${descStr}`;
      }

      if (noLogo || entity === 'ATA') {
        return `
          <tr>
            <td>${escapeHtml(dateStr)}</td>
            <td>${descStr}</td>
            <td class="num">${formatPHP(total)}</td>
          </tr>
        `;
      } else {
        return `
          <tr>
            <td>${escapeHtml(dateStr)}</td>
            <td>${descStr}</td>
            <td></td>
            <td class="num">${formatPHP(total)}</td>
          </tr>
        `;
      }
    }).join('');



    const vatHtml = isVat
      ? `<div class="vat-breakdown">
          <p><strong>VAT Breakdown</strong></p>
          <p>VATable Sales: ${formatPHP(subtotal)}</p>
          <p>VAT Amount (12%): ${formatPHP(vatAmount)}</p>
          <p>Total Amount Due: ${formatPHP(inv.total)}</p>
        </div>`
      : '';

    const clientNameEscaped = escapeHtml(client?.name || '—');
    const clientTradeNameEscaped = client?.tradeName ? `<p>(${escapeHtml(client.tradeName)})</p>` : '';
    const clientAddressEscaped = escapeHtml(client?.address || '—');
    const clientTinEscaped = client?.tin ? `<p>TIN: ${escapeHtml(client.tin)}</p>` : '';
    const invoiceNumberEscaped = escapeHtml(inv.invoiceNumber);
    const invoiceDateEscaped = escapeHtml(formatDate(inv.issueDate));
    const dateValEscaped = escapeHtml(dateVal);
    const cashValEscaped = escapeHtml(cashVal);
    const checkValEscaped = escapeHtml(checkVal);
    const bankValEscaped = escapeHtml(bankVal);

    d.body.innerHTML = `
      ${headerHtml}

      <div class="two-col">
        <div class="col-bill-to">
          <div class="bill-to-title">${entity === 'ATA' ? 'BILL TO' : 'BILL TO:'}</div>
          <div class="bill-to-content">
            <p><strong>${clientNameEscaped}</strong></p>
            ${clientTradeNameEscaped}
            <p>${clientAddressEscaped}</p>
            ${clientTinEscaped}
          </div>
        </div>
        <div class="col-details">
          <table class="details-table">
            <tr>
              <td class="details-label">STATEMENT NUMBER</td>
              <td class="details-value">${invoiceNumberEscaped}</td>
            </tr>
            <tr>
              <td class="details-label">STATEMENT DATE</td>
              <td class="details-value">${invoiceDateEscaped}</td>
            </tr>
          </table>
        </div>
      </div>

      <table class="items-table">
        <thead>
          ${tableHeaders}
        </thead>
        <tbody>
          ${balanceForwardRow}
          ${lineItemsHtml}
        </tbody>
      </table>

      <div class="bottom-container">
        <div class="payment-details-box">
          <div class="payment-details-title">PAYMENT DETAILS:</div>
          <div class="payment-details-row"><span>DATE:</span><span class="fill-line" style="padding-left: 5px; font-weight: bold;">${dateValEscaped}</span></div>
          <div class="payment-details-row"><span>CASH:</span><span class="fill-line" style="padding-left: 5px; font-weight: bold;">${cashValEscaped}</span></div>
          <div class="payment-details-row"><span>DATE/CHECK NO.:</span><span class="fill-line" style="padding-left: 5px; font-weight: bold;">${checkValEscaped}</span></div>
          <div class="payment-details-row"><span>BANK/BRANCH:</span><span class="fill-line" style="padding-left: 5px; font-weight: bold;">${bankValEscaped}</span></div>
        </div>
        <div class="total-box-container" style="width: 50%;">
          <table class="total-table">
            <tr>
              <td class="total-label">TOTAL AMOUNT DUE</td>
              <td class="total-currency">PHP</td>
              <td class="total-value">${formatPHP(inv.total).replace('₱', '').trim()}</td>
            </tr>
          </table>
        </div>
      </div>
      ${vatHtml}

      <div class="signature-row">
        <div class="signature-box">
          <div class="signature-label">Noted by:</div>
          <div class="signature-line-container">
            <div class="signature-name-printed">HENRY WONG</div>
          </div>
        </div>
        <div class="signature-box">
          <div class="signature-label">Prepared by:</div>
          <div class="signature-line-container">
            <div class="signature-name-printed">&nbsp;</div>
          </div>
        </div>
        <div class="signature-box">
          <div class="signature-label">Received by:</div>
          <div class="signature-line-container">
            <div class="signature-name-printed">&nbsp;</div>
          </div>
        </div>
      </div>

      <div class="footer-container">
        <div class="thank-you">THANK YOU !!!</div>
        ${entity === 'ATA'
          ? `<div class="footer-text">customer's copy</div>`
          : `<div class="footer-text underline">Should you have any enquiries concerning this statement, please contact us on 742-8582/404-4928</div>`
        }
      </div>

    `;

    setTimeout(() => w.print(), 300);
  },

  generateVoucher(inv) {
    const client = window.apiClient.clientCache.getById(inv.clientId);
    const entity = inv.entity || 'ATA';
    const w = window.open('', '_blank');
    if (!w) return;
    const d = w.document;

    const title = d.createElement('title');
    title.textContent = 'Payment Voucher ' + inv.invoiceNumber;
    d.head.appendChild(title);

    const style = d.createElement('style');
    style.textContent = `
      @page { size: A4; margin: 15mm 20mm; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1e293b; max-width: 210mm; margin: 0 auto; padding: 0; }
      .doc-title { text-align: center; font-size: 16pt; font-weight: 700; letter-spacing: 4px; margin: 0 0 16px; text-transform: uppercase; }
      .page-break { page-break-before: always; }
      .section { margin-bottom: 20px; }
      .section h3 { font-size: 10pt; text-transform: uppercase; color: #64748b; margin: 0 0 8px; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
      .section p { margin: 4px 0; font-size: 10pt; }
      .section strong { color: #334155; }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
      .box { border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; }
      th { background: #f8fafc; border-bottom: 2px solid #1e293b; padding: 8px; text-align: left; font-weight: 600; text-transform: uppercase; font-size: 9pt; }
      td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
      .num { text-align: right; }
      .amount-words { font-style: italic; font-size: 10pt; color: #475569; margin-top: 4px; }
      .approval-row { display: flex; justify-content: space-between; margin-top: 48px; gap: 24px; }
      .approval-box { flex: 1; text-align: center; }
      .approval-box .line { border-top: 1px solid #1e293b; margin-top: 40px; padding-top: 4px; font-size: 9pt; }
      .footer { margin-top: 24px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
    `;
    d.head.appendChild(style);

    const subtotal = this.getSubtotal(inv);
    const paid = this.getPaidAmount(inv);
    const balance = inv.total - paid;
    const amountWords = this._numberToWords(inv.total) + ' PESOS ONLY';

    // Build dynamic payment details section
    let paymentDetailsHtml = '';
    if (Array.isArray(inv.payments) && inv.payments.length > 0) {
      // If payments exist, show each one with full details
      const payRows = inv.payments.map((p, idx) => {
        const pAmountWords = this._numberToWords(p.amount) + ' PESOS ONLY';
        let detailRows = '';
        if (p.method === 'Check') {
          detailRows = `
            <tr><td><strong>Check Number</strong></td><td>${escapeHtml(p.checkNumber || '—')}</td></tr>
            <tr><td><strong>Drawee Bank</strong></td><td>${escapeHtml(p.bankName || '—')}</td></tr>`;
        } else if (p.method === 'Bank Transfer') {
          detailRows = `
            <tr><td><strong>Bank Name</strong></td><td>${escapeHtml(p.bankName || '—')}</td></tr>
            <tr><td><strong>Account Number</strong></td><td>${escapeHtml(p.bankAccount || '—')}</td></tr>
            <tr><td><strong>Transaction Reference</strong></td><td>${escapeHtml(p.transactionId || '—')}</td></tr>`;
        } else if (['GCash','Maya','PayPal','Other Digital'].includes(p.method)) {
          detailRows = `
            <tr><td><strong>Wallet / Account</strong></td><td>${escapeHtml(p.digitalAccount || '—')}</td></tr>
            <tr><td><strong>Transaction Reference</strong></td><td>${escapeHtml(p.transactionId || '—')}</td></tr>`;
        } else if (['Credit Card','Debit Card'].includes(p.method)) {
          detailRows = `
            <tr><td><strong>Card Last 4 Digits</strong></td><td>**** ${escapeHtml(p.cardLast4 || '—')}</td></tr>
            <tr><td><strong>Authorization Code</strong></td><td>${escapeHtml(p.transactionId || '—')}</td></tr>
            <tr><td><strong>Card Issuer</strong></td><td>${escapeHtml(p.bankName || '—')}</td></tr>`;
        }
        return `
          <div class="box" style="margin-bottom:12px;">
            <p><strong>Payment ${idx + 1} — ${escapeHtml(p.method)}</strong> <span style="font-size:9pt;color:#475569;">(${formatDate(p.date)})</span></p>
            <div class="grid-2">
              <div>
                <p><strong>Amount:</strong> ${formatPHP(p.amount)}</p>
                <p class="amount-words">${escapeHtml(pAmountWords)}</p>
              </div>
              <div>
                <table style="margin:0;">${detailRows}</table>
              </div>
            </div>
            ${p.reference ? `<p style="margin-top:6px; font-size:9pt; color:#64748b;">General Ref: ${escapeHtml(p.reference)}</p>` : ''}
            ${p.notes ? `<p style="font-size:9pt; color:#64748b; font-style:italic;">Notes: ${escapeHtml(p.notes)}</p>` : ''}
          </div>`;
      }).join('');

      const remainingHtml = balance > 0
        ? `<div class="box" style="background:#fef3c7; border-color:#f59e0b;">
             <p><strong>Remaining Balance:</strong> ${formatPHP(balance)}</p>
             <p style="font-size:9pt;">Invoice is partially paid. ${inv.payments.length} payment(s) recorded.</p>
           </div>`
        : `<div class="box" style="background:#dcfce7; border-color:#10b981;">
             <p><strong>Status: FULLY PAID</strong></p>
             <p style="font-size:9pt;">All ${inv.payments.length} payment(s) have been recorded and applied.</p>
           </div>`;

      paymentDetailsHtml = `
        <div class="section">
          <h3>Payment Record</h3>
          ${payRows}
          ${remainingHtml}
        </div>`;
    } else {
      // No payments recorded — show template blanks for manual entry
      paymentDetailsHtml = `
        <div class="section">
          <h3>Payment Details</h3>
          <div class="grid-2">
            <div class="box">
              <p><strong>Amount in Figures:</strong> ${formatPHP(inv.total)}</p>
              <p class="amount-words"><strong>Amount in Words:</strong> ${escapeHtml(amountWords)}</p>
            </div>
            <div class="box">
              <p><strong>Payment Mode:</strong> ___________________</p>
              <p><strong>Check / Ref No.:</strong> ___________________</p>
              <p><strong>Bank / Platform:</strong> ___________________</p>
              <p><strong>Date:</strong> ___________________</p>
            </div>
          </div>
        </div>`;
    }

    const clientNameEscaped = escapeHtml(client?.name || '—');
    const clientTinEscaped = escapeHtml(client?.tin || '—');
    const clientAddressEscaped = escapeHtml(client?.address || '—');
    const invoiceNumberEscaped = escapeHtml(inv.invoiceNumber);

    d.body.innerHTML = `
      <div style="text-align:center; margin-bottom:4px;">
        <div style="font-size:14pt; font-weight:700; letter-spacing:1px;">${escapeHtml(entity)} Accounting Services Firm</div>
      </div>
      <div style="border-bottom:2px solid #1e293b; margin-bottom:16px;"></div>

      <div class="doc-title">Payment Voucher</div>

      <div class="grid-2">
        <div class="box">
          <h3>Voucher Details</h3>
          <p><strong>Voucher No.:</strong> PV-${invoiceNumberEscaped}</p>
          <p><strong>Date:</strong> ${formatDate(new Date().toISOString().slice(0, 10))}</p>
          <p><strong>Reference Invoice:</strong> ${invoiceNumberEscaped}</p>
        </div>
        <div class="box">
          <h3>Payee Information</h3>
          <p><strong>${clientNameEscaped}</strong></p>
          <p>TIN: ${clientTinEscaped}</p>
          <p>${clientAddressEscaped}</p>
        </div>
      </div>

      ${paymentDetailsHtml}

      <div class="section">
        <h3>Account Distribution (PFRS Chart of Accounts)</h3>
        <table>
          <thead>
            <tr><th>Account Code</th><th>Account Title</th><th>Debit</th><th>Credit</th></tr>
          </thead>
          <tbody>
            <tr><td>61010</td><td>Professional Fees Expense</td><td class="num">${formatPHP(subtotal)}</td><td class="num">—</td></tr>
            <tr><td>22010</td><td>Expanded Withholding Tax Payable (EWT)</td><td class="num">${formatPHP(Math.round(subtotal * 0.10 * 100) / 100)}</td><td class="num">—</td></tr>
            <tr><td>11010</td><td>Cash in Bank</td><td class="num">—</td><td class="num">${formatPHP(inv.total)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="section page-break">
        <h3>Supporting Documents</h3>
        <p>☐ Service Invoice No. ${invoiceNumberEscaped} dated ${formatDate(inv.issueDate)}</p>
        <p>☐ Purchase Order / Contract Reference: _________________</p>
        <p>☐ BIR Form 2307 (Certificate of Creditable Tax Withheld at Source): _________________</p>
      </div>

      <div class="approval-row">
        <div class="approval-box">
          <div class="line">Prepared By<br><span style="font-size:8pt;color:#64748b;">Signature / Printed Name / Date</span></div>
        </div>
        <div class="approval-box">
          <div class="line">Reviewed By<br><span style="font-size:8pt;color:#64748b;">Signature / Printed Name / Date</span></div>
        </div>
        <div class="approval-box">
          <div class="line">Approved By<br><span style="font-size:8pt;color:#64748b;">Signature / Printed Name / Date</span></div>
        </div>
        <div class="approval-box">
          <div class="line">Received By<br><span style="font-size:8pt;color:#64748b;">Payee Signature / Printed Name / Date</span></div>
        </div>
      </div>

      <div class="footer">
        This Payment Voucher is prepared in accordance with PFRS, RR No. 9-2009, and RMO No. 29-2002.<br>
        Retain for BIR audit trail. EWT remittance via BIR Form 1601-EQ.
      </div>
    `;

    setTimeout(() => w.print(), 300);
  },

  _numberToWords(num) {
    const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    const convert = (n) => {
      if (n < 20) return ones[n];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
      if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
      if (n < 1000000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
      if (n < 1000000000) return convert(Math.floor(n / 1000000)) + ' Million' + (n % 1000000 ? ' ' + convert(n % 1000000) : '');
      return '';
    };
    const whole = Math.floor(num);
    const dec = Math.round((num - whole) * 100);
    let result = convert(whole) || 'Zero';
    if (dec > 0) result += ' and ' + convert(dec) + ' Centavos';
    return result.toUpperCase();
  },

  methodIcon(method) {
    const icons = PaymentIcons;
    const def = icons['Other Digital'];
    const cfg = icons[method] || def;
    const wrap = el('span', {
      style: `display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius: 12px; font-size:0.75rem; font-weight:700; color:${cfg.color}; background:${cfg.bg}; letter-spacing:0.3px;`
    });
    const svgWrap = document.createElement('span');
    svgWrap.innerHTML = cfg.svg;
    wrap.appendChild(svgWrap.firstChild);
    wrap.appendChild(document.createTextNode(cfg.label));
    return wrap;
  },

  // ============================================================
  // Templates View
  // ============================================================
  async renderTemplates() {
    const entity = Auth.activeEntity;
    const wrapper = el('div', { class: 'page-content-section' });

    await this.ensureTemplates();
    const templates = this._templates;

    const backlogItems = templates.map(t => {
      const client = window.apiClient.clientCache.getById(t.clientId);
      return {
        id: t.id,
        name: t.name,
        iconHtml: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-primary);"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        tags: [
          { text: client?.name || 'No Client', type: 'client' },
          { text: t.schedule || '—', type: 'schedule', value: t.schedule, style: 'text-transform: capitalize;' },
          { text: formatPHP(t.pfAmount || 0), type: 'amount' }
        ]
      };
    });

    this.backgroundRefreshTemplates().catch(err => {
      if (!isAbortError(err)) console.warn('Billing template background refresh failed', err);
    });

    const backlog = JiraBacklogList.render({
      title: 'Billing Templates',
      subtitle: 'recurring professional fee billing and invoice schedules',
      items: backlogItems,
      emptyText: 'No billing templates found',
      rowIdPrefix: 'BL',
      headerActions: [
        {
          text: '+ New Template',
          className: 'btn btn-primary btn-sm',
          onClick: () => this.showTemplateForm()
        }
      ],
      rowActions: (item) => {
        const t = templates.find(temp => temp.id === item.id);
        return [
          {
            text: 'Generate',
            className: 'btn btn-primary btn-xs',
            onClick: () => this.generateFromTemplate(t)
          },
          {
            text: 'Edit',
            className: 'btn btn-secondary btn-xs',
            onClick: () => this.showTemplateForm(t)
          },
          {
            text: 'Delete',
            className: 'btn btn-danger btn-xs',
            onClick: () => {
              Workflow.showConfirm('Delete Template', `Are you sure you want to delete "${t.name}"?`, async () => {
                try {
                  await window.apiClient.invoices.deleteTemplate(t.id);
                  this._templates = this._templates.filter(tm => tm.id !== t.id);
                  this._counts = null; // invalidate counts
                } catch (e) {
                  console.error('Failed to delete template', t.id, e);
                  Workflow.showMessage('Delete Failed', e.message || 'Unable to delete template.', 'error');
                  return;
                }
                App.handleRoute();
              }, 'danger');
            }
          }
        ];
      },
      bulkActions: (selectedIds) => [
        {
          text: selectedIds.length === 1 ? '⚡ Generate Invoice' : '⚡ Bulk Generate Invoices',
          className: 'btn btn-primary btn-sm',
          onClick: (ids) => {
            const title = ids.length === 1 ? 'Generate Invoice' : 'Bulk Generate Invoices';
            const message = ids.length === 1
              ? 'Are you sure you want to generate an invoice for this selected template?'
              : `Are you sure you want to generate invoices for all ${ids.length} selected templates?`;
            Workflow.showConfirm(title, message, async () => {
              const activeEntity = Auth.activeEntity;
              const templatesToGenerate = [];

              // Build all optimistic records first so the UI updates in one shot.
              for (const id of ids) {
                const t = templates.find(temp => temp.id === id);
                if (!t) continue;
                const client = window.apiClient.clientCache.getById(t.clientId);
                const recordEntity = (activeEntity && activeEntity !== 'ALL')
                  ? activeEntity
                  : (client?.entity || Auth.user?.entities?.[0] || 'ATA');
                const now = new Date();
                const invoiceNumber = await this.nextInvoiceNumber(recordEntity);
                const subtotal = (t.lineItems || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
                const optimisticId = 'temp-bulk-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '-' + id;
                const payload = {
                  invoiceNumber,
                  clientId: t.clientId,
                  workRequestId: null,
                  issueDate: now.toISOString().slice(0, 10),
                  dueDate: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString().slice(0, 10),
                  status: 'Draft',
                  lineItems: (t.lineItems || []).map(item => ({ ...item, amount: parseFloat(item.amount) || 0, type: item.type || 'Professional Fee' })),
                  notes: null,
                  terms: null,
                };
                const optimisticRecord = {
                  ...payload,
                  id: optimisticId,
                  entity: recordEntity,
                  archived: false,
                  paidAmount: 0,
                  subtotal,
                  total: subtotal,
                  balance: subtotal,
                  fromTemplate: t.id,
                  clientName: client?.name || null,
                  createdBy: Auth.user.id,
                  createdAt: now.toISOString(),
                  updatedAt: now.toISOString()
                };
                this._detailCache[optimisticId] = optimisticRecord;
                this._addToListCache(optimisticRecord, { prepend: true });
                templatesToGenerate.push({ t, optimisticId, payload, recordEntity });
              }

              if (templatesToGenerate.length === 0) return;

              this._detailCacheEntity = activeEntity;
              this._updateCounts(templatesToGenerate.length, 0);
              this.view = 'list';
              const skipGeneration = this._beginSkipGeneration();
              App.handleRoute();

              const failed = [];
              let succeededCount = 0;
              for (const { t, optimisticId, payload, recordEntity } of templatesToGenerate) {
                try {
                  const res = await window.apiClient.invoices.create(payload);
                  const inv = this.normalizeInvoice({ ...res.data, fromTemplate: t.id, entity: recordEntity });
                  delete this._detailCache[optimisticId];
                  this._detailCache[inv.id] = inv;
                  this._replaceInListCache(optimisticId, inv);
                  this._invalidateRelatedCaches(inv);
                  succeededCount++;
                } catch (e) {
                  console.error('Failed to generate invoice from template', t.id, e);
                  failed.push({ t, optimisticId, error: e });
                  delete this._detailCache[optimisticId];
                  this._removeFromListCache(optimisticId);
                }
              }

              // Recalc counts if any generation failed.
              if (failed.length > 0) {
                this._updateCounts(-failed.length, 0);
              }

              // Clear the skip generation and refresh from the server so temp records
              // are replaced by their server counterparts (or removed if they failed).
              this._endSkipGeneration(skipGeneration);
              App.handleRoute();

              // Report results; the list was already rendered optimistically.
              if (failed.length === 0) {
                Workflow.showMessage('Success', `Generated ${succeededCount} invoice${succeededCount === 1 ? '' : 's'} successfully.`, 'success');
              } else {
                const names = failed.map(f => `"${f.t.name}"`).join(', ');
                Workflow.showMessage('Error', `${failed.length} template(s) could not be generated (${names}).`, 'error');
              }
            });
          }
        },
        {
          text: 'Delete',
          className: 'btn btn-danger btn-sm',
          onClick: (ids) => {
            const title = ids.length === 1 ? 'Delete Template' : 'Delete Templates';
            const message = ids.length === 1
              ? 'Are you sure you want to delete this selected template?'
              : `Are you sure you want to delete these ${ids.length} selected templates?`;
            Workflow.showConfirm(title, message, async () => {
              try {
                await Promise.all(ids.map(id => window.apiClient.invoices.deleteTemplate(id)));
                this._templates = this._templates.filter(tm => !ids.includes(tm.id));
                this._counts = null; // invalidate counts
              } catch (e) {
                console.error('Failed to bulk delete templates', e);
                Workflow.showMessage('Delete Failed', e.message || 'Unable to delete templates.', 'error');
                return;
              }
              App.handleRoute();
            }, 'danger');
          }
        }
      ]
    });

    wrapper.appendChild(backlog);
    return wrapper;
  },

  refreshTemplateList(container) {
    // Legacy method preserved for compatibility/no-op
    while (container.firstChild) container.removeChild(container.firstChild);
  },

  renderTemplateForm(opts = {}) {
    const { hideHeader = false, template = null } = opts;
    const entity = Auth.activeEntity;
    const container = el('div', { class: 'page' });

    const form = el('form', { id: 'billing-tpl-form', class: 'form-stacked notion-form' });

    if (!hideHeader) {
      const headerBar = el('div', { class: 'form-header-bar' });
      const topActions = el('div', { class: 'form-actions-top' });
      topActions.appendChild(el('button', { type: 'submit', form: 'billing-tpl-form', class: 'btn btn-primary', text: 'Save Template' }));
      if (template) {
        const delBtn = el('button', { type: 'button', class: 'btn btn-danger', text: 'Delete', style: 'margin-left: 8px;' });
        delBtn.addEventListener('click', () => {
          Workflow.showConfirm('Delete Template', `Are you sure you want to delete "${template.name}"?`, async () => {
            try {
              await window.apiClient.invoices.deleteTemplate(template.id);
              this._templates = this._templates.filter(t => t.id !== template.id);
              this._counts = null; // invalidate counts
            } catch (e) {
              console.error('Failed to delete template', template.id, e);
              Workflow.showMessage('Delete Failed', e.message || 'Unable to delete template.', 'error');
              return;
            }
            this.view = 'templates';
            this.templateEditingId = null;
            closeFormPanelAndRoute('#billing');
          }, 'danger');
        });
        topActions.appendChild(delBtn);
      }
      headerBar.appendChild(topActions);
      form.appendChild(headerBar);
    }

    // ── Title free-form ──
    const titleSection = el('div', { class: 'notion-freeform notion-freeform--title' });
    titleSection.appendChild(el('label', { class: 'notion-section-label', text: 'Template Name' }));
    const nameInput = el('input', {
      type: 'text', name: 'name', class: 'notion-freeform-input notion-title-input',
      placeholder: 'New Billing Template', required: true, value: template?.name || ''
    });
    titleSection.appendChild(nameInput);
    form.appendChild(titleSection);

    const clientGroup = el('div', { class: 'form-group' });
    clientGroup.appendChild(el('label', { text: 'Client *' }));
    const clientSel = el('select', { name: 'clientId', required: true });
    clientSel.appendChild(el('option', { value: '', text: '— Select Client —' }));
    const clients = window.apiClient.clientCache._clients || [];
    clients.filter(c => {
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes((c.entity || '').toUpperCase());
      return (c.entity || '').toUpperCase() === entity.toUpperCase();
    }).forEach(c => {
      const opt = el('option', { value: c.id, text: c.name });
      if (template && template.clientId === c.id) opt.selected = true;
      clientSel.appendChild(opt);
    });
    clientGroup.appendChild(clientSel);
    form.appendChild(clientGroup);

    const schedGroup = el('div', { class: 'form-group' });
    schedGroup.appendChild(el('label', { text: 'Schedule *' }));
    const schedSel = el('select', { name: 'schedule', required: true });
    ['monthly', 'quarterly'].forEach(s => {
      const opt = el('option', { value: s, text: s });
      if (template && template.schedule === s) opt.selected = true;
      schedSel.appendChild(opt);
    });
    schedGroup.appendChild(schedSel);
    form.appendChild(schedGroup);

    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Professional Fee Amount *' }),
      el('input', { type: 'number', name: 'pfAmount', min: 0, step: 0.01, required: true, value: template?.pfAmount || '' })
    ]));

    form.addEventListener('submit', e => {
      e.preventDefault();
      this.submitTemplateForm(form, template).catch(err => console.error('submitTemplateForm error', err));
    });

    container.appendChild(form);
    return container;
  },

  async submitTemplateForm(form, template) {
    if (!validateRequiredFields(form)) return;
    const entity = Auth.activeEntity;
    const fd = new FormData(form);
    const payload = {
      name: fd.get('name').trim(),
      clientId: fd.get('clientId'),
      entity: entity,
      schedule: fd.get('schedule'),
      pfAmount: parseFloat(fd.get('pfAmount')) || 0,
      lineItems: [
        { type: 'Professional Fee', description: fd.get('name').trim(), amount: parseFloat(fd.get('pfAmount')) || 0 }
      ]
    };

    // Optimistic local cache update BEFORE the API call.
    const optimisticId = !template ? ('temp-tpl-' + Date.now() + '-' + Math.random().toString(36).slice(2)) : null;
    const priorTemplate = template ? deepClone(template) : null;

    if (!template) {
      const client = window.apiClient.clientCache.getById(payload.clientId);
      const recordEntity = (entity && entity !== 'ALL') ? entity : (client?.entity || Auth.user?.entities?.[0] || 'ATA');
      const optimisticTemplate = {
        ...payload,
        id: optimisticId,
        entity: recordEntity,
        active: true,
        clientName: client?.name || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this._templates.push(optimisticTemplate);
      this._templatesEntity = entity;
    } else {
      const idx = this._templates.findIndex(t => t.id === template.id);
      if (idx >= 0) {
        this._templates[idx] = { ...this._templates[idx], ...payload, updatedAt: new Date().toISOString() };
      }
    }
    this.view = 'templates';
    this.templateEditingId = null;
    const skipGeneration = this._beginSkipGeneration();
    closeFormPanelAndRoute('#billing');

    let serverTemplate = null;
    try {
      if (template) {
        const res = await window.apiClient.invoices.updateTemplate(template.id, payload);
        serverTemplate = this.normalizeTemplate(res.data);
      } else {
        const res = await window.apiClient.invoices.createTemplate(payload);
        serverTemplate = this.normalizeTemplate(res.data);
      }
    } catch (e) {
      console.error('Failed to save billing template', e);
      if (optimisticId) {
        this._templates = this._templates.filter(t => t.id !== optimisticId);
      } else if (priorTemplate) {
        const idx = this._templates.findIndex(t => t.id === priorTemplate.id);
        if (idx >= 0) this._templates[idx] = priorTemplate;
      }
      this._endSkipGeneration(skipGeneration);
      App.handleRoute();
      Workflow.showMessage('Error', e.message || 'Unable to save template.', 'error');
      return;
    }

    if (serverTemplate) {
      const idx = this._templates.findIndex(t => t.id === serverTemplate.id || (optimisticId && t.id === optimisticId));
      if (idx >= 0) this._templates[idx] = serverTemplate;
      else this._templates.push(serverTemplate);
    }
    this._counts = null; // invalidate counts

    // Refresh from the server with the server-approved template and toast.
    this._endSkipGeneration(skipGeneration);
    App.handleRoute();
    Workflow.showMessage('Template Saved', `Template "${serverTemplate?.name || payload.name}" saved successfully.`, 'success');
  },

  async showTemplateForm(existing = null, mode = null) {
    this.templateEditingId = existing ? existing.id : null;
    const fullPageRoute = this.templateEditingId ? `#billing/templateForm/${this.templateEditingId}` : '#billing/templateForm/new';
    const template = this.templateEditingId ? await this.getTemplateById(this.templateEditingId) : null;
    openFormPanel({
      icon: '📋',
      title: template?.name ? `Edit ${template.name}` : 'New Billing Template',
      formContent: this.renderTemplateForm({ template }),
      formId: 'billing-tpl-form',
      mode,
      viewContext: 'billing-template-form',
      fullPageRoute,
      newTabRoute: fullPageRoute,
      actions: [
        { text: 'Save Template', class: 'btn btn-primary', type: 'submit', form: 'billing-tpl-form' },
        { text: 'Cancel', class: 'btn btn-secondary', onClick: () => closeFormPanelAndRoute('#billing') }
      ]
    });
  },

  async generateFromTemplate(t) {
    const activeEntity = Auth.activeEntity;
    const client = window.apiClient.clientCache.getById(t.clientId);
    const recordEntity = (activeEntity && activeEntity !== 'ALL')
      ? activeEntity
      : (client?.entity || Auth.user?.entities?.[0] || 'ATA');
    const now = new Date();
    const invoiceNumber = await this.nextInvoiceNumber(recordEntity);
    const optimisticId = 'temp-gen-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const payload = {
      invoiceNumber,
      clientId: t.clientId,
      workRequestId: null,
      issueDate: now.toISOString().slice(0, 10),
      dueDate: new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString().slice(0, 10),
      status: 'Draft',
      lineItems: (t.lineItems || []).map(item => ({ ...item, amount: parseFloat(item.amount) || 0, type: item.type || 'Professional Fee' })),
      notes: null,
      terms: null,
    };

    // Optimistic local cache update BEFORE the API call.
    const subtotal = payload.lineItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
    const optimisticRecord = {
      ...payload,
      id: optimisticId,
      entity: recordEntity,
      archived: false,
      paidAmount: 0,
      subtotal,
      total: subtotal,
      balance: subtotal,
      fromTemplate: t.id,
      clientName: client?.name || null,
      createdBy: Auth.user.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    this._detailCache[optimisticId] = optimisticRecord;
    this._detailCacheEntity = activeEntity;
    this._addToListCache(optimisticRecord, { prepend: true });
    this._updateCounts(1, 0);
    this.view = 'list';
    const skipGeneration = this._beginSkipGeneration();
    App.handleRoute();

    try {
      const res = await window.apiClient.invoices.create(payload);
      const inv = this.normalizeInvoice({ ...res.data, fromTemplate: t.id, entity: recordEntity });
      delete this._detailCache[optimisticId];
      this._detailCache[inv.id] = inv;
      this._replaceInListCache(optimisticId, inv);
      this._invalidateRelatedCaches(inv);
      this._endSkipGeneration(skipGeneration);
      App.handleRoute();
      Workflow.showMessage('Invoice Success', 'Generated invoice ' + inv.invoiceNumber, 'success');
    } catch (e) {
      console.error('Failed to generate invoice from template', e);
      delete this._detailCache[optimisticId];
      this._removeFromListCache(optimisticId);
      this._updateCounts(-1, 0);
      this._endSkipGeneration(skipGeneration);
      App.handleRoute();
      Workflow.showMessage('Error', e.message || 'Unable to generate invoice.', 'error');
    }
  },

  trashInvoice(id) {
    const inv = this.getInvoiceById(id);
    if (!inv || inv.archived) return;
    Workflow.showConfirm('Move to Trash',
      `Are you sure you want to trash invoice "${inv.invoiceNumber}"? It will be moved to Archive.`,
      async () => {
        const snapshot = this._snapshotInvoice(id);
        // Optimistic local update: mark archived and remove from active list cache.
        inv.archived = true;
        inv.updatedAt = new Date().toISOString();
        if (this._detailCache[id]) {
          this._detailCache[id].archived = true;
          this._detailCache[id].updatedAt = inv.updatedAt;
        }
        this._removeFromListCache(id);
        this._updateCounts(-1, 1);
        const skipGeneration = this._beginSkipGeneration();
        if (this.view === 'detail' && this.detailId === id) {
          location.hash = '#billing';
        }
        App.handleRoute();
        try {
          await window.apiClient.invoices.archive(id);
          this._endSkipGeneration(skipGeneration);
          App.handleRoute();
          Workflow.showMessage('Trashed', 'Invoice has been moved to Archive.', 'success');
        } catch (e) {
          console.error('Failed to trash invoice', e);
          this._rollbackInvoice(id, snapshot);
          this._addToListCache(snapshot);
          this._updateCounts(1, -1);
          this._endSkipGeneration(skipGeneration);
          Workflow.showMessage('Error', e.message || 'Unable to trash invoice.', 'error');
          App.handleRoute();
        }
      },
      'warning'
    );
  },

  restoreInvoice(id) {
    const inv = this.getInvoiceById(id);
    if (!inv || inv.status !== 'Cancelled') return;
    Workflow.showConfirm('Restore Invoice',
      `Are you sure you want to restore invoice "${inv.invoiceNumber}"?`,
      async () => {
        const snapshot = this._snapshotInvoice(id);
        const restored = { ...inv, status: 'Draft', archived: false, updatedAt: new Date().toISOString() };
        this._detailCache[id] = restored;
        this._addToListCache(restored);
        this._updateCounts(1, -1);
        const skipGeneration = this._beginSkipGeneration();
        App.handleRoute();
        try {
          await window.apiClient.invoices.update(id, { status: 'Draft', archived: false });
          this._endSkipGeneration(skipGeneration);
          App.handleRoute();
          Workflow.showMessage('Restored', 'Invoice has been restored to the active list.', 'success');
        } catch (e) {
          console.error('Failed to restore invoice', e);
          this._rollbackInvoice(id, snapshot);
          this._addToListCache(snapshot);
          this._updateCounts(-1, 1);
          this._endSkipGeneration(skipGeneration);
          Workflow.showMessage('Error', e.message || 'Unable to restore invoice.', 'error');
          App.handleRoute();
        }
      },
      'warning'
    );
  },

  archiveInvoice(id) {
    const inv = this.getInvoiceById(id);
    if (!inv || inv.status !== 'Paid' || inv.archived) return;
    Workflow.showConfirm('Archive Invoice',
      `Are you sure you want to archive invoice "${inv.invoiceNumber}"?`,
      async () => {
        const snapshot = this._snapshotInvoice(id);
        const archived = { ...inv, archived: true, updatedAt: new Date().toISOString() };
        this._detailCache[id] = archived;
        this._addToListCache(archived);
        this._updateCounts(-1, 1);
        const skipGeneration = this._beginSkipGeneration();
        App.handleRoute();
        try {
          await window.apiClient.invoices.archive(id);
          this._endSkipGeneration(skipGeneration);
          App.handleRoute();
          Workflow.showMessage('Archived', 'Invoice has been archived.', 'success');
        } catch (e) {
          console.error('Failed to archive invoice', e);
          this._rollbackInvoice(id, snapshot);
          this._addToListCache(snapshot);
          this._updateCounts(1, -1);
          this._endSkipGeneration(skipGeneration);
          Workflow.showMessage('Error', e.message || 'Unable to archive invoice.', 'error');
          App.handleRoute();
        }
      },
      'warning'
    );
  },

  bulkArchiveInvoices(ids) {
    const eligible = (ids || [])
      .map(id => this.getInvoiceById(id))
      .filter(inv => inv && inv.status === 'Paid' && !inv.archived);

    if (eligible.length === 0) {
      Workflow.showMessage('No eligible records', 'Only Paid invoices can be archived.', 'info');
      return;
    }

    Workflow.showConfirm('Bulk Archive',
      `Are you sure you want to archive ${eligible.length} paid invoice(s)?`,
      async () => {
        const snapshots = new Map(eligible.map(inv => [inv.id, this._snapshotInvoice(inv.id)]));
        // Optimistic local update: mark archived and upsert into the all-invoice cache.
        eligible.forEach(inv => {
          if (this._detailCache[inv.id]) {
            this._detailCache[inv.id].archived = true;
            this._detailCache[inv.id].updatedAt = new Date().toISOString();
            this._addToListCache(this._detailCache[inv.id]);
          }
        });
        this._updateCounts(-eligible.length, eligible.length);
        const skipGeneration = this._beginSkipGeneration();
        App.handleRoute();
        const failed = [];
        for (const inv of eligible) {
          try {
            await window.apiClient.invoices.update(inv.id, { archived: true });
          } catch (e) {
            console.error('Failed to archive invoice', inv.id, e);
            failed.push(inv.id);
          }
        }
        if (failed.length > 0) {
          failed.forEach(id => {
            const snapshot = snapshots.get(id);
            this._rollbackInvoice(id, snapshot);
            this._addToListCache(snapshot);
          });
          this._updateCounts(failed.length, -failed.length);
          this._endSkipGeneration(skipGeneration);
          App.handleRoute();
          Workflow.showMessage('Error', `${failed.length} invoice(s) could not be archived.`, 'error');
        } else {
          this._endSkipGeneration(skipGeneration);
          App.handleRoute();
          Workflow.showMessage('Archived', `${eligible.length} invoice(s) archived.`, 'success');
        }
      },
      'warning'
    );
  },

  bulkTrashInvoices(ids) {
    if (!Auth.can('billing:edit')) {
      Workflow.showMessage('Permission Denied', 'You do not have permission to trash invoices.', 'danger');
      return;
    }

    const eligible = (ids || [])
      .map(id => this.getInvoiceById(id))
      .filter(inv => inv && inv.status === 'Draft');

    if (eligible.length === 0) {
      Workflow.showMessage('No eligible records', 'Only Draft invoices can be moved to trash.', 'info');
      return;
    }

    Workflow.showConfirm('Move to Trash',
      `Are you sure you want to move ${eligible.length} draft invoice(s) to trash?`,
      async () => {
        const snapshots = new Map(eligible.map(inv => [inv.id, this._snapshotInvoice(inv.id)]));
        // Optimistic local update: mark cancelled/archived and upsert into the all-invoice cache.
        eligible.forEach(inv => {
          if (this._detailCache[inv.id]) {
            this._detailCache[inv.id].status = 'Cancelled';
            this._detailCache[inv.id].archived = true;
            this._detailCache[inv.id].updatedAt = new Date().toISOString();
            this._addToListCache(this._detailCache[inv.id]);
          }
        });
        this._updateCounts(-eligible.length, eligible.length);
        const skipGeneration = this._beginSkipGeneration();
        App.handleRoute();
        const failed = [];
        for (const inv of eligible) {
          try {
            await window.apiClient.invoices.remove(inv.id);
          } catch (e) {
            console.error('Failed to trash invoice', inv.id, e);
            failed.push(inv.id);
          }
        }
        if (failed.length > 0) {
          failed.forEach(id => {
            const snapshot = snapshots.get(id);
            this._rollbackInvoice(id, snapshot);
            this._addToListCache(snapshot);
          });
          this._updateCounts(failed.length, -failed.length);
          this._endSkipGeneration(skipGeneration);
          App.handleRoute();
          Workflow.showMessage('Error', `${failed.length} invoice(s) could not be moved to trash.`, 'error');
        } else {
          this._endSkipGeneration(skipGeneration);
          App.handleRoute();
          Workflow.showMessage('Moved to Trash', `${eligible.length} invoice(s) moved to trash.`, 'warning');
        }
      },
      'danger'
    );
  },

  unarchiveInvoice(id) {
    const inv = this.getInvoiceById(id);
    if (!inv || inv.status !== 'Paid' || !inv.archived) return;
    Workflow.showConfirm('Unarchive Invoice',
      `Are you sure you want to unarchive invoice "${inv.invoiceNumber}"?`,
      async () => {
        const snapshot = this._snapshotInvoice(id);
        const restored = { ...inv, archived: false, updatedAt: new Date().toISOString() };
        this._detailCache[id] = restored;
        this._addToListCache(restored);
        this._updateCounts(1, -1);
        const skipGeneration = this._beginSkipGeneration();
        App.handleRoute();
        try {
          await window.apiClient.invoices.update(id, { archived: false });
          this._endSkipGeneration(skipGeneration);
          App.handleRoute();
          Workflow.showMessage('Restored', 'Invoice has been restored to the active list.', 'success');
        } catch (e) {
          console.error('Failed to unarchive invoice', e);
          this._rollbackInvoice(id, snapshot);
          this._addToListCache(snapshot);
          this._updateCounts(-1, 1);
          this._endSkipGeneration(skipGeneration);
          Workflow.showMessage('Error', e.message || 'Unable to unarchive invoice.', 'error');
          App.handleRoute();
        }
      },
      'warning'
    );
  },

  permanentDeleteInvoice(id) {
    const inv = this.getInvoiceById(id);
    if (!inv) return;
    if (Auth.user?.role !== 'Admin' && !Auth.isManagerial() && !Auth.can('billing:delete')) {
      Workflow.showMessage('Permission Denied', 'Only authorized users can permanently delete invoices.', 'danger');
      return;
    }
    Workflow.showConfirm('Permanently Delete Invoice',
      `Are you sure you want to permanently delete invoice "${inv.invoiceNumber}"? This action cannot be undone.`,
      async () => {
        const entity = Auth.activeEntity;
        const snapshot = this._snapshotInvoice(id);
        const wasActive = snapshot && this._isActiveInvoice(snapshot, entity);
        const wasArchived = snapshot && this._isArchiveInvoice(snapshot, entity);
        delete this._detailCache[id];
        this._removeFromListCache(id);
        this._updateCounts(wasActive ? -1 : 0, wasArchived ? -1 : 0);
        const skipGeneration = this._beginSkipGeneration();
        // Route away from the stale detail view before showing the success toast.
        if (this.view === 'detail' && this.detailId === id) {
          location.hash = '#billing';
        }
        App.handleRoute();
        try {
          await window.apiClient.invoices.remove(id);
          this._endSkipGeneration(skipGeneration);
          App.handleRoute();
          Workflow.showMessage('Deleted', 'Invoice has been permanently deleted.', 'success');
        } catch (e) {
          console.error('Failed to delete invoice', e);
          this._rollbackInvoice(id, snapshot);
          this._addToListCache(snapshot);
          this._updateCounts(wasActive ? 1 : 0, wasArchived ? 1 : 0);
          this._endSkipGeneration(skipGeneration);
          Workflow.showMessage('Error', e.message || 'Unable to delete invoice.', 'error');
          App.handleRoute();
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
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(ent.toUpperCase());
      return ent.toUpperCase() === entity.toUpperCase();
    };

    let archivedInvoices = [];
    try {
      archivedInvoices = await this.fetchInvoices({
        archived: true,
        page: this._archivePage,
        limit: this._archiveLimit,
      });
      this._lastArchiveMeta = this._lastInvoiceMeta || {};
    } catch (e) {
      this._lastArchiveMeta = {};
    }

    archivedInvoices = archivedInvoices.filter(inv => this._isArchiveInvoice(inv, entity));
    const paid = archivedInvoices.filter(inv => inv.archived === true);
    const cancelled = archivedInvoices.filter(inv => inv.status === 'Cancelled' && !inv.archived);

    let rejectedInvoiceChanges = [];
    let rejectedBillingRequests = [];
    try {
      const pendingRes = await window.apiClient.admin.listPendingApprovals({ status: 'rejected', tableName: 'invoices' });
      rejectedInvoiceChanges = (pendingRes.data || []).filter(pc => {
        const data = pc.proposedData || {};
        if (!entFilter(data.entity || '')) return false;
        if (!isManagerial && pc.submittedBy !== Auth.user.id) return false;
        return true;
      });
    } catch (e) {
      console.error('Failed to load rejected invoice changes', e);
    }
    try {
      const opReqRes = await window.apiClient.operationsRequests.list({ status: 'rejected', type: 'billing' });
      rejectedBillingRequests = (opReqRes.data || []).filter(r => {
        if (!entFilter(r.entity || '')) return false;
        if (!isManagerial && r.requestedBy !== Auth.user.id) return false;
        return true;
      });
    } catch (e) {
      console.error('Failed to load rejected billing requests', e);
    }

    const buildInvItem = (inv, category) => {
      const client = window.apiClient.clientCache.getById(inv.clientId);
      return {
        id: inv.id,
        category,
        title: inv.invoiceNumber || '(no number)',
        meta: [
          { icon: ArchivePage.icons.client, text: client?.name || '—' },
          { icon: ArchivePage.icons.amount, text: formatPHP(inv.total) },
          { icon: ArchivePage.icons.date, text: formatDate(inv.updatedAt) }
        ],
        actions: [
          {
            label: 'View',
            icon: ArchivePage.icons.view,
            onClick: () => { location.hash = '#billing/detail/' + inv.id; }
          },
          ...(category === 'accomplished' ? [{
            label: 'Unarchive',
            icon: ArchivePage.icons.unarchive,
            className: 'primary',
            onClick: () => self.unarchiveInvoice(inv.id)
          }] : []),
          ...(category === 'cancelled' ? [{
            label: 'Restore to Draft',
            icon: ArchivePage.icons.restore,
            className: 'primary',
            onClick: () => self.restoreInvoice(inv.id)
          }] : []),
          ...(isManagerial || Auth.can('billing:delete') ? [{
            label: 'Delete Permanently',
            icon: ArchivePage.icons.delete,
            className: 'danger',
            onClick: () => self.permanentDeleteInvoice(inv.id)
          }] : [])
        ]
      };
    };

    const buildRejectedItem = (record) => {
      const isOpReq = record.hasOwnProperty('requestedBy');
      const pc = isOpReq ? null : record;
      const r = isOpReq ? record : null;
      const data = pc ? (pc.proposedData || {}) : r;
      const clientName = (window.apiClient.clientCache.getById(data.clientId) || window.apiClient.clientCache.getById(r?.clientId))?.name || '—';
      const title = isOpReq
        ? `Billing Request ${r.workRequestId ? 'for WR' : ''}`
        : `Invoice Change: ${data.invoiceNumber || '(untitled)'}`;
      const reason = data.rejectionReason || r?.rejectionReason || 'Rejected';
      return {
        id: record.id,
        category: 'rejected',
        title,
        meta: [
          { icon: ArchivePage.icons.client, text: clientName },
          { icon: ArchivePage.icons.date, text: formatDate(pc?.reviewedAt || pc?.updatedAt || r?.requestedAt || r?.updatedAt) },
          { icon: ArchivePage.icons.status, text: `Reason: ${reason}` }
        ],
        actions: [
          ...(data.id || r?.workRequestId ? [{
            label: 'View Related',
            icon: ArchivePage.icons.view,
            onClick: () => {
              if (data.id) location.hash = '#billing/detail/' + data.id;
              else if (r?.workRequestId) location.hash = '#operations/detail/' + r.workRequestId;
            }
          }] : [])
        ]
      };
    };

    const meta = this._lastArchiveMeta || {};
    const page = meta.page || this._archivePage || 1;
    const limit = meta.limit || this._archiveLimit || 20;
    const total = meta.total || 0;

    return ArchivePage.render({
      module: 'billing',
      categoryLabels: { accomplished: 'Paid', cancelled: 'Cancelled', rejected: 'Rejected' },
      categories: {
        accomplished: paid.map(inv => buildInvItem(inv, 'accomplished')),
        cancelled: cancelled.map(inv => buildInvItem(inv, 'cancelled')),
        rejected: [
          ...rejectedInvoiceChanges.map(buildRejectedItem),
          ...rejectedBillingRequests.map(buildRejectedItem)
        ]
      },
      emptyText: 'Archive is empty.',
      renderCallback: () => self.renderArchive(),
      pagination: {
        page,
        limit,
        total,
        onPage: (newPage) => {
          self._archivePage = newPage;
          App.handleRoute();
        }
      }
    });
  },

  // ============================================================
  // Aging Report
  // ============================================================
  async renderAging() {
    const container = el('div', { class: 'page-content-section' });
    try {
      const res = await window.apiClient.invoices.aging();
      const details = res.data?.details || {};
      const summary = res.data?.summary || {};
      const bucketMap = {
        '0-30': { keys: ['current', '1-30'], label: '0-30 Days' },
        '31-60': { keys: ['31-60'], label: '31-60 Days' },
        '61-90': { keys: ['61-90'], label: '61-90 Days' },
        '90+': { keys: ['90+'], label: '90+ Days' }
      };

      const grid = el('div', { class: 'kpi-grid' });
      Object.entries(bucketMap).forEach(([bucketKey, { keys, label }]) => {
        let total = 0;
        let count = 0;
        keys.forEach(k => {
          const b = details[k];
          if (b) {
            total += b.total || 0;
            count += (b.invoices || []).length;
          }
        });
        grid.appendChild(this.kpiCard(label, count + ' invoices', formatPHP(total)));
      });
      container.appendChild(grid);
    } catch (e) {
      console.error('Failed to load aging report', e);
      container.appendChild(renderEmptyState('Unable to load aging report', e.message, { variant: 'zero-state' }));
    }
    return container;
  },

  kpiCard(label, sub, value) {
    const card = el('div', { class: 'kpi-card' });
    card.appendChild(el('div', { class: 'kpi-label', text: label }));
    card.appendChild(el('div', { class: 'kpi-sub', text: sub }));
    card.appendChild(el('div', { class: 'kpi-value', text: value }));
    return card;
  }
};

window.Billing = Billing;
