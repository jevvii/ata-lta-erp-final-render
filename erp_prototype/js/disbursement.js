/**
 * Disbursement & Expense Module
 * Expense filing, fund source tagging, 1-tier approval, templates, print voucher.
 */

const Disbursement = {
  view: 'list', // 'list' | 'form' | 'detail' | 'report' | 'templates' | 'templateForm'
  detailId: null,
  templateEditingId: null,
  listViewMode: 'table', // 'table' | 'board' | 'list'
  EDITABLE_STATUSES: ['Draft', 'Pending'],
  PENDING_APPROVAL_STATUSES: ['Pending', 'Submitted', 'Under Review', 'Approved'],
  STANDARD_CATEGORIES: ['Transportation', 'Notary', 'Meals', 'Government Fee', 'Other'],

  // API-backed disbursement cache
  _items: null,
  _promise: null,
  _detailCache: {},
  _counts: null, // cached tab-badge counts from the backend
  _entity: null,
  _loadingEntity: null,
  _loadGeneration: 0,
  _archivePage: 1,
  _archiveLimit: 20,
  _lastArchiveMeta: {},
  _rejectedArchiveCounts: null,
  _skipFetchGeneration: 0,
  _activeSkipGeneration: 0,
  _backgroundPromise: null,

  // API-backed disbursement template cache
  _templates: [],
  _templatesPromise: null,
  _templatesEntity: null,
  _templatesGeneration: 0,
  _templatesBackgroundPromise: null,

  normalizeTemplate(doc) {
    if (!doc) return doc;
    return {
      id: doc.id,
      name: doc.name,
      entity: doc.entities?.code || doc.entity_code || doc.entity || doc.entity_id,
      category: doc.category || '',
      amount: parseFloat(doc.amount) || 0,
      fundSource: doc.fund_source || doc.fundSource || 'Firm Fund',
      schedule: doc.schedule || '',
      description: doc.description || '',
      linkedWorkRequestId: doc.linked_work_request_id || doc.linkedWorkRequestId || null,
      linkedInvoiceId: doc.linked_invoice_id || doc.linkedInvoiceId || null,
      createdAt: doc.created_at || doc.createdAt,
      updatedAt: doc.updated_at || doc.updatedAt,
      clientName: doc.clients?.name || doc.clientName || null
    };
  },

  toApiTemplate(record) {
    return {
      name: record.name,
      category: record.category,
      amount: parseFloat(record.amount) || 0,
      fundSource: record.fundSource || 'Firm Fund',
      schedule: record.schedule || null,
      description: record.description || null,
      linkedWorkRequestId: record.linkedWorkRequestId || null,
      linkedInvoiceId: record.linkedInvoiceId || null
    };
  },

  async fetchTemplates() {
    try {
      const res = await window.apiClient.disbursements.listTemplates();
      return (res.data || []).map(t => this.normalizeTemplate(t));
    } catch (e) {
      console.error('Failed to fetch disbursement templates', e);
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
      console.error('Failed to load disbursement templates', e);
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

  async loadTemplates() {
    await this.ensureTemplates();
    return this._templates;
  },

  async getTemplateById(id) {
    if (!id) return null;
    const cached = (this._templates || []).find(t => t.id === id);
    if (cached) return JSON.parse(JSON.stringify(cached));
    try {
      await this.ensureTemplates();
      const template = (this._templates || []).find(t => t.id === id) || null;
      return template ? JSON.parse(JSON.stringify(template)) : null;
    } catch (e) {
      console.error('Failed to fetch template by id', id, e);
      return null;
    }
  },

  _entityCodeFromId(entityId) {
    if (!entityId) return null;
    return Auth.activeEntity !== 'ALL' ? Auth.activeEntity : null;
  },

  /**
   * Convert a backend disbursement row (snake_case, joined clients.name)
   * into the camelCase shape expected by the UI.
   */
  normalizeDisbursement(d, entityCodeHint) {
    if (!d) return d;
    const entity = entityCodeHint
      || d.entityCode
      || d.entity_code
      || (typeof d.entity === 'string' && ['ATA', 'LTA'].includes(d.entity.toUpperCase()) ? d.entity : null)
      || this._entityCodeFromId(d.entity_id || d.entityId)
      || Auth.activeEntity;
    const status = d.status || 'Draft';
    const approvedBy = d.approved_by || null;
    const paymentDetails = d.payment_method ? {
      method: d.payment_method,
      reference: d.payment_reference || '',
      bank: d.payment_bank || '',
      date: d.payment_date || '',
      processedBy: d.payment_processed_by || null
    } : (d.payment_details || null);
    return {
      id: d.id,
      disbursementNumber: d.disbursement_number || d.disbursementNumber || null,
      entityId: d.entity_id || d.entityId || null,
      entity,
      category: d.category || '',
      description: d.description || '',
      amount: typeof d.amount === 'number' ? d.amount : parseFloat(d.amount) || 0,
      fundSource: d.fund_source || d.fundSource || 'Firm Fund',
      status,
      clientId: d.client_id || d.clientId || null,
      clientName: d.clients?.name || d.clientName || null,
      employeeId: d.employee_id || d.employeeId || null,
      linkedInvoiceId: d.linked_invoice_id || d.linkedInvoiceId || null,
      linkedWorkRequestId: d.linked_work_request_id || d.linkedWorkRequestId || null,
      linkedTaskId: d.linked_task_id || d.linkedTaskId || null,
      requestedBy: d.requested_by || d.requestedBy || null,
      dueDate: d.due_date || d.dueDate || null,
      notes: d.notes || null,
      approvedBy,
      approvedAt: d.approved_at || d.approvedAt || null,
      releasedBy: d.released_by || d.releasedBy || null,
      releasedAt: d.released_at || d.releasedAt || null,
      rejectedBy: d.rejected_by || d.rejectedBy || null,
      rejectedAt: d.rejected_at || d.rejectedAt || null,
      rejectionReason: d.rejection_reason || d.rejectionReason || null,
      paymentHandledBy: d.payment_handled_by || d.paymentHandledBy || approvedBy || null,
      paymentDetails,
      receiptS3Key: d.receipt_s3_key || d.receiptS3Key || null,
      receiptFilename: d.receipt_filename || d.receiptFilename || (d.receipt_s3_key ? 'Receipt' : null),
      releaseFilename: d.release_filename || d.releaseFilename || null,
      archived: d.archived || false,
      createdAt: d.created_at || d.createdAt || null,
      updatedAt: d.updated_at || d.updatedAt || null,
      createdBy: d.created_by || d.createdBy || null,
      updatedBy: d.updated_by || d.updatedBy || null,
      // UI-only convenience fields (backend does not persist these)
      fromTemplate: d.from_template || d.fromTemplate || false,
      submittedAt: d.submitted_at || d.submittedAt || d.created_at || d.createdAt || null,
      voucherNumber: d.disbursement_number || d.voucherNumber || null,
      boardOrder: typeof d.board_order === 'number' ? d.board_order : (typeof d.boardOrder === 'number' ? d.boardOrder : null)
    };
  },

  /**
   * Convert UI form record to backend create/update payload.
   */
  toApiPayload(data) {
    return {
      category: data.category,
      description: data.description,
      amount: typeof data.amount === 'number' ? data.amount : parseFloat(data.amount) || 0,
      fundSource: data.fundSource || 'Firm Fund',
      clientId: data.clientId || null,
      employeeId: data.employeeId || null,
      linkedInvoiceId: data.linkedInvoiceId || null,
      linkedWorkRequestId: data.linkedWorkRequestId || null,
      dueDate: data.dueDate || null,
      notes: data.notes || null
    };
  },

  _getActiveEntity() {
    return (typeof Auth !== 'undefined' && Auth.activeEntity) || null;
  },

  _isTempId(id) {
    return typeof id === 'string' && /^(tmp-|temp-|opt-|usr-opt-|tx-temp-|tpl-)/.test(id);
  },

  _setActiveSkipGeneration() {
    this._skipFetchGeneration = (this._skipFetchGeneration || 0) + 1;
    this._activeSkipGeneration = this._skipFetchGeneration;
    this._loadGeneration++;
    return this._activeSkipGeneration;
  },

  _clearSkipGenerationIfCurrent(gen) {
    if (this._activeSkipGeneration === gen) {
      this._activeSkipGeneration = 0;
    }
  },

  _isEntityFresh() {
    return this._entity === this._getActiveEntity();
  },

  hasData() {
    return Array.isArray(this._items) && this._isEntityFresh();
  },

  hasCachedData(entity) {
    return this.hasData() && this._entity === entity;
  },

  async ensure() {
    const skipping = this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration;
    if (skipping || this.hasData()) return;
    const activeEntity = this._getActiveEntity();
    if (this._promise && this._loadingEntity === activeEntity) return this._promise;
    const loadGen = ++this._loadGeneration;
    this._loadingEntity = activeEntity;
    const promise = this._load(loadGen).finally(() => {
      if (this._loadGeneration === loadGen) {
        this._promise = null;
        this._loadingEntity = null;
      }
    });
    this._promise = promise;
    return promise;
  },

  async _load(loadGen, options = {}) {
    const entity = this._getActiveEntity();
    try {
      const res = await window.apiClient.disbursements.list(options);
      const items = (res.data || []).map(d => this.normalizeDisbursement(d));
      if (loadGen !== this._loadGeneration || this._getActiveEntity() !== entity) {
        return this._items || [];
      }
      if (this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration) {
        return this._items || [];
      }
      const cacheWarm = Array.isArray(this._items) && this._entity === entity;
      if (cacheWarm) {
        this._mergeItems(items);
      } else {
        this._items = items;
      }
      this._entity = entity;
      this._refreshCounts();
      return this._items;
    } catch (err) {
      if (isAbortError(err)) {
        if (!this._items) this._items = [];
        this._refreshCounts();
        return this._items;
      }
      console.error('Failed to load disbursements', err);
      if (loadGen !== this._loadGeneration || this._getActiveEntity() !== entity) {
        return this._items || [];
      }
      if (!this._items) this._items = [];
      this._entity = entity;
      this._refreshCounts();
      return this._items;
    }
  },

  _mergeItems(serverItems) {
    if (!Array.isArray(this._items)) this._items = [];
    const existingMap = new Map(this._items.map(d => [d.id, d]));
    const isSkipActive = this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration;
    serverItems.forEach(serverItem => {
      const existing = existingMap.get(serverItem.id);
      if (existing) {
        const localNewer = existing.updatedAt && serverItem.updatedAt && new Date(existing.updatedAt) > new Date(serverItem.updatedAt);
        if (isSkipActive || localNewer) {
          const localArchived = existing.archived;
          const localStatus = existing.status;
          Object.assign(existing, serverItem);
          if (localArchived !== undefined) existing.archived = localArchived;
          if (localStatus !== undefined) existing.status = localStatus;
        } else {
          Object.assign(existing, serverItem);
        }
      } else if (!this._isTempId(serverItem.id)) {
        this._items.push(serverItem);
      }
    });
  },

  async backgroundRefresh() {
    if (this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration) {
      return this._items || [];
    }
    if (this._backgroundPromise) return this._backgroundPromise;
    const loadGen = ++this._loadGeneration;
    this._backgroundPromise = this._load(loadGen).finally(() => {
      if (this._loadGeneration === loadGen) this._backgroundPromise = null;
    });
    return this._backgroundPromise;
  },

  async loadDisbursements(force = false) {
    if (force) this.invalidateCache(true);
    await this.ensure();
    return this._items || [];
  },

  async fetchDisbursements(query = {}) {
    try {
      const res = await window.apiClient.disbursements.list(query);
      this._lastDisbursementMeta = res.meta || {};
      return (res.data || []).map(d => this.normalizeDisbursement(d));
    } catch (e) {
      console.error('Failed to fetch disbursements', e);
      Workflow.showMessage('Disbursements', e.message || 'Unable to load disbursements.', 'error');
      this._lastDisbursementMeta = {};
      return [];
    }
  },

  invalidateCache(force = false) {
    const shouldSkip = this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration;
    if (!force && shouldSkip) return;
    this._items = null;
    this._detailCache = {};
    this._counts = null;
    this._promise = null;
    this._loadingEntity = null;
    this._loadGeneration++;
    this._entity = null;
    this._rejectedArchiveCounts = null;
    this._skipFetchGeneration = 0;
    this._activeSkipGeneration = 0;
    this._templates = [];
    this._templatesEntity = null;
    this._templatesGeneration++;
    this._templatesPromise = null;
    this._templatesBackgroundPromise = null;
  },

  async loadDisbursement(id) {
    if (!id || this._isTempId(id)) return null;
    if (this._detailCache[id]) return this._detailCache[id];
    try {
      const res = await window.apiClient.disbursements.get(id);
      const normalized = this.normalizeDisbursement(res.data);
      this._detailCache[id] = normalized;
      return normalized;
    } catch (err) {
      console.error('Failed to load disbursement', id, err);
      return null;
    }
  },

  _entityMatches(item, entity = this._getActiveEntity()) {
    if (!item) return false;
    const itemEnt = (item?.entity || item?.entityCode || item?.entity_code || '').toUpperCase();
    if (!itemEnt) return true;
    const active = (entity || '').toUpperCase();
    if (!active || active === 'ALL') {
      const userEnts = (Auth.user?.entities || []).map(e => e.toUpperCase());
      return userEnts.length > 0 ? userEnts.includes(itemEnt) : true;
    }
    return itemEnt === active;
  },

  _activeBadgeFilter(d) {
    return !d.archived && d.status !== 'Cancelled';
  },

  _archiveBadgeFilter(d) {
    return !!d.archived || d.status === 'Cancelled';
  },

  _recalcCounts(entity = this._getActiveEntity()) {
    const items = (this._items || []).filter(d => this._entityMatches(d, entity));
    return {
      active: items.filter(d => this._activeBadgeFilter(d)).length,
      archived: items.filter(d => this._archiveBadgeFilter(d)).length,
      rejected: items.filter(d => d.status === 'Rejected').length
    };
  },

  _refreshCounts() {
    if (!this.hasData()) {
      this._counts = null;
      return;
    }
    this._counts = this._recalcCounts();
  },

  _invalidateDashboardCache() {
    if (typeof Dashboard !== 'undefined' && Dashboard._dataCache) {
      Dashboard._dataCache = null;
    }
  },

  _copyItem(item) {
    if (!item) return item;
    return JSON.parse(JSON.stringify(item));
  },

  _getCachedItem(id) {
    if (!this._items) return null;
    const idx = this._items.findIndex(d => d.id === id);
    return idx >= 0 ? this._copyItem(this._items[idx]) : null;
  },

  _updateCachedDisbursement(id, patch) {
    if (!id || !patch) return;
    if (this._items) {
      const idx = this._items.findIndex(d => d.id === id);
      if (idx >= 0) {
        this._items[idx] = { ...this._items[idx], ...patch };
      }
    }
    if (this._detailCache[id]) {
      this._detailCache[id] = { ...this._detailCache[id], ...patch };
    }
  },

  _removeCachedDisbursement(id) {
    if (!this._items) return null;
    const idx = this._items.findIndex(d => d.id === id);
    if (idx >= 0) {
      const removed = this._items.splice(idx, 1)[0];
      return removed;
    }
    return null;
  },

  _tempId(prefix = 'tmp') {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  },

  _getOptimisticEntity() {
    const activeEntity = this._getActiveEntity();
    return (activeEntity && activeEntity !== 'ALL') ? activeEntity : (Auth.user?.entities?.[0] || 'ATA');
  },

  _assignEntity(record) {
    if (!record.entity) {
      record.entity = this._getOptimisticEntity();
    }
    record.entityId = record.entityId || record.entity || null;
    return record;
  },

  _buildOptimisticDisbursement(source = {}, overrides = {}) {
    const now = new Date().toISOString();
    const record = this.normalizeDisbursement({
      id: this._tempId(),
      disbursementNumber: null,
      category: '',
      description: '',
      amount: 0,
      fundSource: 'Firm Fund',
      status: 'Draft',
      clientId: null,
      clientName: null,
      employeeId: Auth.user?.id || null,
      linkedInvoiceId: null,
      linkedWorkRequestId: null,
      linkedTaskId: null,
      requestedBy: Auth.user?.id || null,
      dueDate: null,
      notes: null,
      approvedBy: null,
      approvedAt: null,
      releasedBy: null,
      releasedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      paymentHandledBy: null,
      paymentDetails: null,
      receiptS3Key: null,
      receiptFilename: null,
      releaseFilename: null,
      archived: false,
      createdAt: now,
      updatedAt: now,
      createdBy: Auth.user?.id || null,
      updatedBy: Auth.user?.id || null,
      fromTemplate: false,
      submittedAt: now,
      voucherNumber: null,
      boardOrder: null,
      ...source,
      ...overrides
    });
    return this._assignEntity(record);
  },

  _replaceInItems(localId, serverRecord) {
    if (!this._items) {
      this._items = [serverRecord];
      this._entity = this._getActiveEntity();
      return;
    }
    // Avoid duplicates if a background fetch already returned the server record.
    this._items = this._items.filter(d => d.id !== serverRecord.id);
    const idx = this._items.findIndex(d => d.id === localId);
    if (idx >= 0) {
      this._items[idx] = serverRecord;
    } else {
      this._items.unshift(serverRecord);
    }
  },

  _removeFromItems(localId) {
    if (!this._items) return;
    const idx = this._items.findIndex(d => d.id === localId);
    if (idx >= 0) this._items.splice(idx, 1);
    if (this._detailCache[localId]) delete this._detailCache[localId];
  },

  _insertOptimisticDisbursement(record) {
    if (!this._items) {
      this._items = [];
      this._entity = this._getActiveEntity();
    }
    this._items.unshift(record);
    this._refreshCounts();
    this._invalidateDashboardCache();
    this._setActiveSkipGeneration();
    return record;
  },

  _addOptimisticDisbursement(record, { skipRoute = false } = {}) {
    this._insertOptimisticDisbursement(record);
    if (!skipRoute && this.view !== 'form' && this.view !== 'templateForm' && this.view !== 'detail') {
      App.handleRoute();
    }
    return record;
  },

  _replaceOptimisticCreate(localId, serverRecord) {
    this._replaceInItems(localId, serverRecord);
    this._detailCache[serverRecord.id] = serverRecord;
    this._refreshCounts();
    this._invalidateRelatedCaches(serverRecord);
  },

  _rollbackOptimisticCreate(localId, error, title = 'Error') {
    const gen = this._activeSkipGeneration;
    this._removeFromItems(localId);
    this._refreshCounts();
    this._invalidateDashboardCache();
    this._clearSkipGenerationIfCurrent(gen);
    if (this.view !== 'form' && this.view !== 'templateForm' && this.view !== 'detail') {
      App.handleRoute();
    }
    Workflow.showMessage('Error', (error && error.message) || title, 'error');
  },

  _invalidateRelatedCaches(record) {
    this._invalidateDashboardCache();
    if (record && record.linkedWorkRequestId) {
      // Patch the linked work request in the operations cache so the board/list
      // and any open dropdowns stay usable.
      const wr = typeof WorkflowData !== 'undefined' ? WorkflowData.getWorkRequestById(record.linkedWorkRequestId) : null;
      if (wr) {
        if (!Array.isArray(wr.linkedDisbursementIds)) wr.linkedDisbursementIds = [];
        if (!wr.linkedDisbursementIds.includes(record.id)) wr.linkedDisbursementIds.push(record.id);
      }
      // Also patch the shared work-request cache used by billing/disbursement forms.
      if (window.apiClient?.workRequestCache?.getById) {
        const sharedWr = window.apiClient.workRequestCache.getById(record.linkedWorkRequestId);
        if (sharedWr) {
          if (!Array.isArray(sharedWr.linkedDisbursementIds)) sharedWr.linkedDisbursementIds = [];
          if (!sharedWr.linkedDisbursementIds.includes(record.id)) sharedWr.linkedDisbursementIds.push(record.id);
        }
        if (typeof window.apiClient.workRequestCache.ensure === 'function') {
          window.apiClient.workRequestCache.ensure().catch(() => {});
        }
      }
      if (typeof WorkflowData !== 'undefined' && typeof WorkflowData.ensure === 'function') {
        WorkflowData.ensure().catch(() => {});
      }
    }
    if (typeof App !== 'undefined' && typeof App.updateSidebarNotifications === 'function') {
      App.updateSidebarNotifications().catch(() => {});
    }
  },

  async _optimisticUpdate(id, patch, apiCall, errorTitle = 'Error') {
    if (this._isTempId(id)) {
      Workflow.showMessage('Saving...', 'Please wait for the record to finish saving.', 'info');
      throw new Error('Record is still being saved');
    }
    const originalItem = this._getCachedItem(id);
    const originalDetail = this._copyItem(this._detailCache[id] || null);
    this._updateCachedDisbursement(id, patch);
    this._refreshCounts();
    this._invalidateDashboardCache();
    const gen = this._setActiveSkipGeneration();
    App.handleRoute();
    try {
      const result = await apiCall();
      this._clearSkipGenerationIfCurrent(gen);
      if (typeof window.apiClient?.disbursements?.invalidateCounts === 'function') {
        window.apiClient.disbursements.invalidateCounts();
      }
      if (typeof App !== 'undefined' && typeof App.updateSidebarNotifications === 'function') {
        App.updateSidebarNotifications().catch(() => {});
      }
      App.handleRoute();
      return result;
    } catch (e) {
      console.error(errorTitle, id, e);
      if (originalItem) {
        if (this._items) {
          const idx = this._items.findIndex(d => d.id === id);
          if (idx >= 0) this._items[idx] = originalItem;
        }
      } else {
        this.invalidateCache();
      }
      if (originalDetail) this._detailCache[id] = originalDetail;
      this._refreshCounts();
      this._invalidateDashboardCache();
      this._clearSkipGenerationIfCurrent(gen);
      App.handleRoute();
      Workflow.showMessage('Error', e.message || errorTitle, 'error');
      throw e;
    }
  },

  async _optimisticDelete(id, apiCall, errorTitle = 'Error') {
    if (this._isTempId(id)) {
      Workflow.showMessage('Saving...', 'Please wait for the record to finish saving.', 'info');
      throw new Error('Record is still being saved');
    }
    const originalItem = this._removeCachedDisbursement(id);
    const originalDetail = this._copyItem(this._detailCache[id] || null);
    if (this._detailCache[id]) delete this._detailCache[id];
    this._refreshCounts();
    this._invalidateDashboardCache();
    const gen = this._setActiveSkipGeneration();
    App.handleRoute();
    try {
      const result = await apiCall();
      this._clearSkipGenerationIfCurrent(gen);
      if (typeof window.apiClient?.disbursements?.invalidateCounts === 'function') {
        window.apiClient.disbursements.invalidateCounts();
      }
      if (typeof App !== 'undefined' && typeof App.updateSidebarNotifications === 'function') {
        App.updateSidebarNotifications().catch(() => {});
      }
      App.handleRoute();
      return result;
    } catch (e) {
      console.error(errorTitle, id, e);
      if (originalItem) {
        this._items = this._items || [];
        this._items.push(originalItem);
      } else {
        this.invalidateCache();
      }
      if (originalDetail) this._detailCache[id] = originalDetail;
      this._refreshCounts();
      this._invalidateDashboardCache();
      this._clearSkipGenerationIfCurrent(gen);
      App.handleRoute();
      Workflow.showMessage('Error', e.message || errorTitle, 'error');
      throw e;
    }
  },

  async _loadRejectedArchiveCounts() {
    const entity = this._getActiveEntity();
    const isManagerial = Auth.isManagerial ? Auth.isManagerial() : false;
    let changes = 0;
    let requests = 0;
    try {
      const pendingRes = await window.apiClient.admin.listPendingApprovals({ status: 'rejected', tableName: 'disbursements' });
      changes = ((pendingRes.data || []).filter(pc => {
        const data = pc.proposedData || {};
        if (!this._entityMatches(data, entity)) return false;
        if (!isManagerial && pc.submittedBy !== Auth.user?.id) return false;
        return true;
      })).length;
    } catch (e) {
      console.error('Failed to load rejected disbursement changes', e);
    }
    try {
      const opReqRes = await window.apiClient.operationsRequests.list({ status: 'rejected', type: 'disbursement' });
      requests = ((opReqRes.data || []).filter(r => {
        if (!this._entityMatches(r, entity)) return false;
        if (!isManagerial && r.requestedBy !== Auth.user?.id) return false;
        return true;
      })).length;
    } catch (e) {
      console.error('Failed to load rejected disbursement requests', e);
    }
    this._rejectedArchiveCounts = { changes, requests, total: changes + requests };
    return this._rejectedArchiveCounts;
  },

  /**
   * Fetch badge counts from the API and cache them on the module.
   * The backend sums across entities when Auth.activeEntity is 'ALL'.
   */
  async loadCounts() {
    try {
      const res = await window.apiClient.disbursements.counts();
      this._counts = res?.data || { active: 0, archived: 0, rejected: 0 };
    } catch (err) {
      console.error('Failed to load disbursement counts', err);
      this._counts = { active: 0, archived: 0, rejected: 0 };
    }
    return this._counts;
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

  async render() {
    const container = el('div', { class: 'page' });

    if (this.view === 'detail' && this.detailId) {
      const d = await this.loadDisbursement(this.detailId);
      const titleBar = el('div', { class: 'page-title-bar-v2' });
      const h1 = el('h1', { class: 'breadcrumb-h1' });
      const baseLink = el('a', { href: 'javascript:void(0)', class: 'breadcrumb-base', text: 'Disbursement' });
      baseLink.addEventListener('click', () => { location.hash = '#disbursement'; });
      h1.appendChild(baseLink);
      h1.appendChild(el('span', { class: 'breadcrumb-sep', text: ' / ' }));
      h1.appendChild(document.createTextNode(d?.description || 'Detail'));
      titleBar.appendChild(h1);
      
      const actions = el('div', { class: 'title-bar-actions' });
      if (d) {
        // Edit button — Admin and Accounting (users with disbursement:edit or create)
        const canEdit = Auth.can('disbursement:edit') || Auth.can('disbursement:create');
        const isPendingStatus = ['Draft', 'Submitted', 'Under Review', 'Pending'].includes(d.status);
        if (canEdit && isPendingStatus) {
          const editBtn = el('button', { class: 'btn btn-warning btn-sm', text: '✏️ Edit Expense', style: 'margin-right:8px;' });
          editBtn.addEventListener('click', async () => {
            this.detailId = d.id;
            openFormPanel({
              icon: '💰', title: 'Edit Expense',
              formContent: await this.renderForm({ existing: d }), formId: 'disbursement-form',
              viewContext: 'expense-form',
              fullPageRoute: `#disbursement/form/${d.id}`,
              actions: [
                { text: 'Update Expense', class: 'btn btn-primary', type: 'submit', form: 'disbursement-form', testId: 'submit-expense-btn' },
                { text: 'Cancel', class: 'btn btn-secondary', onClick: () => closeFormPanelAndRoute('#disbursement/detail/' + d.id), testId: 'cancel-expense-btn' }
              ]
            });
          });
          actions.appendChild(editBtn);
        }

        // Trash button — Admin / Managers
        if (Auth.can('disbursement:delete') && !d.archived) {
          const trashBtn = el('button', { class: 'btn btn-danger btn-sm', text: '🗑️ Trash', style: 'margin-right:8px;' });
          trashBtn.addEventListener('click', () => {
            this.trashDisbursement(d.id);
          });
          actions.appendChild(trashBtn);
        }
        if (d.status === 'Draft' && Auth.can('disbursement:create')) {
          const submitBtn = el('button', { class: 'btn btn-success btn-sm', text: 'Submit Expense', style: 'margin-right:8px;' });
          submitBtn.addEventListener('click', () => {
            Workflow.showConfirm('Submit Expense', 'Are you sure you want to submit this expense for approval?', async () => {
              try {
                await this._optimisticUpdate(d.id, { status: 'Pending' }, () => window.apiClient.disbursements.submit(d.id), 'Submit Failed');
              } catch (e) {
                // Error surfaced by _optimisticUpdate.
              }
            }, 'success');
          });
          actions.appendChild(submitBtn);
        }
        const noLogoLabel = el('label', { style: 'margin-right:12px; font-size:0.8125rem; display:inline-flex; align-items:center; gap:6px; cursor:pointer; color:var(--color-text-muted);' });
        const noLogoCheckbox = el('input', { type: 'checkbox' });
        noLogoLabel.appendChild(noLogoCheckbox);
        noLogoLabel.appendChild(document.createTextNode('No Logo (Generic)'));
        actions.appendChild(noLogoLabel);

        const genExpBtn = el('button', { class: 'btn btn-primary btn-sm', text: 'Generate Expense PDF', style: 'margin-right:8px;' });
        genExpBtn.addEventListener('click', () => {
          const noLogo = noLogoCheckbox.checked;
          this.generateExpensePDF(d, noLogo);
        });
        actions.appendChild(genExpBtn);

        const genVouchBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Generate Voucher', style: 'margin-right:8px;' });
        genVouchBtn.addEventListener('click', () => this.generateVoucher(d));
        actions.appendChild(genVouchBtn);
      }
      const backBtn = el('button', { class: 'btn btn-secondary btn-sm', text: '← Back to List' });
      backBtn.addEventListener('click', () => { location.hash = '#disbursement'; });
      actions.appendChild(backBtn);
      titleBar.appendChild(actions);
      container.appendChild(titleBar);
    } else if (this.view === 'form') {
      container.classList.add('disbursement-tab-page');
      const isNew = !this.detailId;
      const existing = isNew ? null : await this.loadDisbursement(this.detailId);
      const fullPageRoute = isNew ? '#disbursement/form/new' : `#disbursement/form/${this.detailId}`;
      const viewSwitcher = buildFormViewSwitcher({
        currentMode: PaneMode.FULL_PAGE,
        viewContext: 'expense-form',
        onSidePeek: () => {
          const expenseId = this.detailId;
          closeFormPanelAndRoute('#disbursement');
          this.showForm(expenseId, PaneMode.SIDE_PEEK);
        },
        onCenterPeek: () => {
          const expenseId = this.detailId;
          closeFormPanelAndRoute('#disbursement');
          this.showForm(expenseId, PaneMode.CENTER_PEEK);
        },
        onNewTab: () => {
          window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
        }
      });
      container.appendChild(buildFormBreadcrumb({
        baseLabel: 'Disbursement',
        baseHash: '#disbursement',
        currentText: isNew ? 'New Expense' : (existing?.description || 'Edit Expense'),
        viewSwitcher,
        actions: [
          { text: isNew ? 'Submit Expense' : 'Save Changes', class: 'btn btn-primary btn-sm', type: 'submit', form: 'disbursement-form' },
          { text: 'Cancel', class: 'btn btn-secondary btn-sm', onClick: () => { location.hash = '#disbursement'; } }
        ]
      }));
    } else if (this.view === 'templateForm') {
      container.classList.add('disbursement-tab-page');
      const isNew = !this.templateEditingId;
      const template = isNew ? null : await this.getTemplateById(this.templateEditingId);
      const fullPageRoute = isNew ? '#disbursement/templateForm/new' : `#disbursement/templateForm/${this.templateEditingId}`;
      const viewSwitcher = buildFormViewSwitcher({
        currentMode: PaneMode.FULL_PAGE,
        viewContext: 'disbursement-template-form',
        onSidePeek: () => {
          closeFormPanelAndRoute('#disbursement');
          this.showTemplateForm(template, PaneMode.SIDE_PEEK);
        },
        onCenterPeek: () => {
          closeFormPanelAndRoute('#disbursement');
          this.showTemplateForm(template, PaneMode.CENTER_PEEK);
        },
        onNewTab: () => {
          window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
        }
      });
      container.appendChild(buildFormBreadcrumb({
        baseLabel: 'Disbursement',
        baseHash: '#disbursement',
        currentText: isNew ? 'New Disbursement Template' : (template?.name || 'Edit Template'),
        viewSwitcher,
        actions: [
          { text: 'Save Template', class: 'btn btn-primary btn-sm', type: 'submit', form: 'disb-tpl-form' },
          { text: 'Cancel', class: 'btn btn-secondary btn-sm', onClick: () => { location.hash = '#disbursement'; } }
        ]
      }));
    } else if (['list', 'templates', 'report', 'archive'].includes(this.view)) {
      container.classList.add('disbursement-tab-page');
      const titleBar = el('div', { class: 'page-title-bar-v2' });
      titleBar.appendChild(el('h1', { text: 'Disbursement' }));
      container.appendChild(titleBar);

      // Pre-load cached disbursements and rejected archive counts so
      // renderTabNav can derive badges from local data instead of the API.
      await this.ensure();
      await this._loadRejectedArchiveCounts();

      container.appendChild(this.renderTabNav());
    }

    if (this.view === 'list') container.appendChild(await this.renderList());
    else if (this.view === 'form') {
      await this._loadPrefilledOpReq();
      container.appendChild(await this.renderForm({ hideHeader: true, existing }));
    }
    else if (this.view === 'detail') container.appendChild(await this.renderDetail());
    else if (this.view === 'report') container.appendChild(await this.renderReport());
    else if (this.view === 'templates') container.appendChild(await this.renderTemplates());
    else if (this.view === 'archive') container.appendChild(await this.renderArchive());
    else if (this.view === 'templateForm') container.appendChild(await this.renderTemplateForm({ hideHeader: true, template }));

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
    const entMatch = ent => {
      const uEnt = (ent || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(uEnt);
      return uEnt === entity.toUpperCase();
    };

    // Derive active/archive badges from the cached _items for the current entity.
    const cachedItems = (this._items || []).filter(d => this._entityMatches(d, entity));
    const dbCount = cachedItems.filter(d => this._activeBadgeFilter(d)).length;
    const archiveDbCount = cachedItems.filter(d => this._archiveBadgeFilter(d)).length;
    const rejectedOpsCount = this._rejectedArchiveCounts?.total || 0;
    const archiveCount = archiveDbCount + rejectedOpsCount;

    const templateCount = (this._templates || []).filter(t => {
      const tEnt = (t.entity || '').toUpperCase();
      if (entity === 'ALL') {
        return Auth.user.entities.map(ae => ae.toUpperCase()).includes(tEnt);
      }
      return tEnt === entity.toUpperCase();
    }).length;

    const tabs = [
      { key: 'list', label: 'Disbursements', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', count: dbCount },
      { key: 'templates', label: 'Templates', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>', count: templateCount },
      { key: 'report', label: 'Summary Report', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
      { key: 'archive', label: 'Archive', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>', count: archiveCount }
    ];

    const tabNav = renderModuleTabNav(tabs, this.view, (key) => {
      this.view = key;
      App.handleRoute();
    });

    const canCreate = Auth.can('disbursement:create');
    const canRequest = Auth.can('disbursement:request');

    if (canCreate && canRequest) {
      const wrapper = el('div', { class: 'split-btn-group' });

      const primaryBtn = el('button', {
        class: 'btn btn-primary btn-sm split-btn-left'
      });
      primaryBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> File Expense';
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
      requestItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Request Disbursement';
      requestItem.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.add('hidden');
        Disbursement.showRequestDisbursementModal();
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
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> File Expense'
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
      reqBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Request Disbursement';
      reqBtn.addEventListener('click', () => { Disbursement.showRequestDisbursementModal(); });
      tabNav.appendChild(reqBtn);
    }

    return tabNav;
  },

  getFundSource(item) {
    if (item.fundSource) return item.fundSource;
    if (item.type === 'ClientFunded') return 'Client Fund';
    return 'Firm Fund';
  },

  getEmployeeId(item) {
    return item.employeeId || item.requestedBy;
  },

  recurringBadge(item) {
    if (!item.fromTemplate) return el('span');
    return el('span', { class: 'badge badge-recurring', text: 'Recurring' });
  },

  canEditDisbursement(d) {
    return Auth.can('disbursement:create') &&
           this.EDITABLE_STATUSES.includes(d.status);
  },

  async showForm(disbId = null, mode = null) {
    this.detailId = disbId;
    const isNew = !disbId;
    const existing = isNew ? null : await this.loadDisbursement(disbId);
    await this._loadPrefilledOpReq();
    const fullPageRoute = isNew ? '#disbursement/form/new' : `#disbursement/form/${disbId}`;

    openFormPanel({
      icon: '💰',
      title: isNew ? 'File Expense' : `Edit Expense — ${existing?.description || ''}`.trim(),
      formContent: await this.renderForm({ existing }),
      formId: 'disbursement-form',
      mode,
      viewContext: 'expense-form',
      fullPageRoute,
      newTabRoute: fullPageRoute,
      actions: [
        { text: isNew ? 'Submit Expense' : 'Save Changes', class: 'btn btn-primary', type: 'submit', form: 'disbursement-form' },
        { text: 'Cancel', class: 'btn btn-secondary', onClick: () => closeFormPanelAndRoute('#disbursement') }
      ]
    });
  },

  statusBadge(status) {
    const map = {
      'Draft': 'badge-warning',
      'Submitted': 'badge-warning',
      'Under Review': 'badge-warning',
      'Pending': 'badge-warning',
      'Approved': 'badge-info',
      'Released': 'badge-success',
      'Funded': 'badge-success',
      'Rejected': 'badge-danger',
      'Cancelled': 'badge-danger'
    };
    const label = status;
    return el('span', { class: 'badge ' + (map[status] || ''), text: label });
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
  // List View
  // ============================================================
  async renderList() {
    const entity = Auth.activeEntity;
    let viewMode = App.getPreferredViewMode('disbursement');
    let groupBy = App.restoreGroupBy('disbursement') || 'none';

    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure()
    ]);

    const groupOptions = [
      { key: 'none', label: 'None' },
      { key: 'employee', label: 'Employee', getName: d => {
        const u = window.apiClient.userCache.getById(this.getEmployeeId(d));
        return u?.name || 'Unassigned';
      }},
      { key: 'workRequest', label: 'Work Request', getName: d => {
        const wr = window.apiClient.workRequestCache.getById(d.linkedWorkRequestId);
        return wr?.title || 'No Work Request';
      }},
      { key: 'client', label: 'Client', getName: d => {
        const wr = window.apiClient.workRequestCache.getById(d.linkedWorkRequestId);
        const client = wr
          ? window.apiClient.clientCache.getById(wr.clientId)
          : window.apiClient.clientCache.getById(d.clientId);
        return client?.name || 'No Client';
      }},
      { key: 'fund', label: 'Fund', getName: d => this.getFundSource(d) || 'No Fund' }
    ];

    const wrapper = el('div');
    const stickyContainer = el('div', { class: 'toolbar-sticky-container' });
    const filters = el('div', { class: 'filters-bar' });



    // Jira Filter Toolbar & Active Filters State
    const activeFilters = {
      workRequest: new Set(),
      client: new Set(),
      employee: new Set(),
      fund: new Set(),
      status: new Set(),
      date: new Set()
    };

    const savedFilters = App.restoreFilters('disbursement');
    if (savedFilters) {
      if (Array.isArray(savedFilters.workRequest)) savedFilters.workRequest.forEach(v => activeFilters.workRequest.add(v));
      else if (savedFilters.workRequest) activeFilters.workRequest.add(savedFilters.workRequest);
      if (Array.isArray(savedFilters.client)) savedFilters.client.forEach(v => activeFilters.client.add(v));
      else if (savedFilters.client) activeFilters.client.add(savedFilters.client);
      if (Array.isArray(savedFilters.employee)) savedFilters.employee.forEach(v => activeFilters.employee.add(v));
      else if (savedFilters.employee) activeFilters.employee.add(savedFilters.employee);
      if (Array.isArray(savedFilters.fund)) savedFilters.fund.forEach(v => activeFilters.fund.add(v));
      else if (savedFilters.fund) activeFilters.fund.add(savedFilters.fund);
      if (Array.isArray(savedFilters.status)) savedFilters.status.forEach(v => activeFilters.status.add(v));
      else if (savedFilters.status) activeFilters.status.add(savedFilters.status);
      if (Array.isArray(savedFilters.date)) savedFilters.date.forEach(v => activeFilters.date.add(v));
    }

    this.searchQuery = '';

    const saveCurrentFilters = () => {
      App.saveFilters('disbursement', {
        workRequest: Array.from(activeFilters.workRequest),
        client: Array.from(activeFilters.client),
        employee: Array.from(activeFilters.employee),
        fund: Array.from(activeFilters.fund),
        status: Array.from(activeFilters.status),
        date: Array.from(activeFilters.date)
      });
    };

    const getWorkRequestOptions = () => {
      const wrs = window.apiClient.workRequestCache._wrs || [];
      return wrs.filter(wr => {
        const wrEnt = (wr.entity || '').toUpperCase();
        return (entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(wrEnt) : wrEnt === entity.toUpperCase()) && Auth.canViewWr(wr);
      }).map(wr => {
        const client = window.apiClient.clientCache.getById(wr.clientId);
        return { value: wr.id, label: wr.title + ' — ' + (client?.name || '—') };
      });
    };

    const getClientOptions = () => {
      const clients = window.apiClient.clientCache._clients || [];
      return clients.filter(c => {
        const clientEnt = (c.entity || '').toUpperCase();
        return entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(clientEnt) : clientEnt === entity.toUpperCase();
      }).map(c => ({ value: c.id, label: c.name }));
    };

    const getEmployeeOptions = () => {
      const set = new Set();
      const users = window.apiClient.userCache._users || [];
      users.filter(u => Auth.ALL_ROLES.includes(u.role)).forEach(u => set.add(u.name));
      const wrs = window.apiClient.workRequestCache._wrs || [];
      wrs.forEach(wr => {
        (wr.tasks || []).forEach(t => {
          const name = (t.assigneeName || '').trim();
          if (name) set.add(name);
        });
      });
      return Array.from(set).map(n => ({ value: n, label: n }));
    };

    const getFundOptions = () => [
      { value: 'Firm Fund', label: 'Firm Fund' },
      { value: 'Client Fund', label: 'Client Fund' }
    ];

    const getStatusOptions = () => [
      { value: 'Draft', label: 'Draft' },
      { value: 'Pending', label: 'Pending' },
      { value: 'Approved', label: 'Approved' },
      { value: 'Released', label: 'Released' },
      { value: 'Funded', label: 'Funded' },
      { value: 'Rejected', label: 'Rejected' }
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
      fund: { label: 'Fund', getOptions: getFundOptions },
      status: { label: 'Status', getOptions: getStatusOptions },
      date: { label: 'Date', hasDatePicker: true, getOptions: getDueDateOptions }
    };

    const toolbarContainer = createJiraFilterToolbar({
      moduleName: 'disbursement',
      searchConfig: {
        placeholder: 'Search disbursement...',
        onSearch: (q) => { this.searchQuery = q; refresh(); }
      },
      categories,
      activeFilters,
      onFilterChange: () => {
        saveCurrentFilters();
        refresh();
      },
      viewMode,
      onViewModeChange: (newMode) => {
        viewMode = newMode;
        App.setPreferredViewMode('disbursement', newMode);
        saveCurrentFilters();
        refresh();
      },
      groupByOptions: groupOptions,
      currentGroupBy: groupBy,
      onGroupByChange: (newGroupBy) => {
        groupBy = newGroupBy;
        App.saveGroupBy('disbursement', groupBy);
        refresh();
      }
    });

    stickyContainer.appendChild(toolbarContainer);
    wrapper.appendChild(stickyContainer);

    const listContainer = el('div');
    wrapper.appendChild(listContainer);

    const refresh = async () => this.refreshList(listContainer, activeFilters, viewMode, groupBy, groupOptions, stickyContainer);
    await refresh();

    return wrapper;
  },

  async refreshList(container, activeFilters, viewMode, groupBy = 'none', groupOptions = [], toolbarContainer = null) {
    container.replaceChildren();
    const entity = Auth.activeEntity;
    const shouldSkip = this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration;
    const isCached = shouldSkip;

    // Ensure the in-memory cache is loaded for the active entity. If it is
    // already warm (including during an optimistic skip), this returns immediately.
    await this.ensure();

    let allItems = this._items || [];
    let items = allItems.filter(d => this._entityMatches(d, entity));

    items = items.filter(d => this._activeBadgeFilter(d));
    const hasItems = items.length > 0;

    if (activeFilters.workRequest && activeFilters.workRequest.size > 0) {
      items = items.filter(d => activeFilters.workRequest.has(d.linkedWorkRequestId));
    }
    if (activeFilters.client && activeFilters.client.size > 0) {
      items = items.filter(d => {
        if (!d.linkedWorkRequestId) return false;
        const wr = window.apiClient.workRequestCache.getById(d.linkedWorkRequestId);
        return wr && activeFilters.client.has(wr.clientId);
      });
    }
    if (activeFilters.employee && activeFilters.employee.size > 0) {
      items = items.filter(d => {
        const empId = d.employeeId || d.requestedBy;
        const u = empId ? window.apiClient.userCache.getById(empId) : null;
        return u && activeFilters.employee.has(u.name);
      });
    }
    if (activeFilters.fund && activeFilters.fund.size > 0) {
      items = items.filter(d => activeFilters.fund.has(this.getFundSource(d)));
    }
    if (activeFilters.status && activeFilters.status.size > 0) {
      items = items.filter(d => {
        if (activeFilters.status.has(d.status)) return true;
        if (activeFilters.status.has('Pending') && this.PENDING_APPROVAL_STATUSES.includes(d.status)) return true;
        return false;
      });
    }
    if (activeFilters.date && activeFilters.date.size > 0) {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const endOfWeek = new Date(now);
      endOfWeek.setDate(now.getDate() + (now.getDay() === 0 ? 0 : 7 - now.getDay()));
      const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const endOfMonthStr = endOfMonth.toISOString().slice(0, 10);

      items = items.filter(d => {
        const dStr = (d.date || d.requestedDate || '').slice(0, 10);
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
      items = items.filter(d => {
        const wr = d.linkedWorkRequestId ? window.apiClient.workRequestCache.getById(d.linkedWorkRequestId) : null;
        const client = wr
          ? window.apiClient.clientCache.getById(wr.clientId)
          : window.apiClient.clientCache.getById(d.clientId);
        const emp = d.employeeId ? window.apiClient.userCache.getById(d.employeeId) : null;
        const hay = [
          d.voucherNumber || d.disbursementNumber || '',
          d.description || d.purpose || '',
          client?.name || '',
          wr?.title || '',
          emp?.name || '',
          d.status || '',
          String(d.amount || ''),
        ].join(' ').toLowerCase();
        return hay.includes(this.searchQuery);
      });
    }
    items.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    const hasActiveFilters = Object.values(activeFilters).some(s => s && s.size > 0) || !!this.searchQuery;

    if (items.length === 0) {
      if (hasActiveFilters && hasItems) {
        container.appendChild(renderFilterEmptyState(
          'No expenses match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('disbursement'); App.handleRoute(); } }]
        ));
      } else {
        container.appendChild(renderEmptyState('No expenses found', null, { variant: 'zero-state' }));
      }
      return;
    }

    if (isCached) {
      container.appendChild(el('div', {
        class: 'disbursement-cached-indicator',
        style: 'text-align:center; padding:8px 0; font-size:12px; color:var(--color-text-muted);',
        text: 'Showing cached results — refresh or switch entity to fetch latest'
      }));
    }

    if (viewMode === 'table') {
      this.renderTableView(container, items);
    } else if (viewMode === 'board') {
      this.renderBoardView(container, items, groupBy, groupOptions, toolbarContainer);
    } else {
      this.renderCompactListView(container, items);
    }

    // Background refresh: silently merge any new/updated server records into
    // the in-memory cache without replacing optimistic records.
    if (!isCached) {
      this.backgroundRefresh().catch(err => {
        if (!isAbortError(err)) console.warn('Disbursement background refresh failed', err);
      });
    }
  },

  renderTableView(container, items) {
    const buildActions = (d) => {
      const wrapper = el('div', { style: 'display: inline-flex; gap: 4px; align-items: center;' });
      if (this._isTempId(d.id)) return wrapper;

      if (this.canEditDisbursement(d)) {
        const editBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Edit' });
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showForm(d.id); });
        wrapper.appendChild(editBtn);
      }

      return wrapper;
    };

    const columns = [
      { key: 'employee', label: 'Employee', render: (d) => window.apiClient.userCache.getById(this.getEmployeeId(d))?.name || '—' },
      {
        key: 'category',
        label: 'Category',
        width: '30%',
        render: (d) => {
          const cell = el('div', { class: 'dt-title-cell' });
          const line = el('div', { style: 'display: flex; align-items: center; gap: 6px; flex-wrap: wrap;' });
          line.appendChild(el('span', { class: 'dt-title-link', text: d.category }));
          if (d.fromTemplate) line.appendChild(this.recurringBadge(d));
          cell.appendChild(line);
          if (d.linkedWorkRequestId) {
            const wr = window.apiClient.workRequestCache.getById(d.linkedWorkRequestId);
            if (wr) {
              const sub = el('div', { style: 'font-size: 0.725rem; color: var(--color-text-muted);' });
              let suffix = ' (Entire WR)';
              if (d.linkedTaskId) {
                const task = (wr.tasks || []).find(t => t.id === d.linkedTaskId);
                if (task) suffix = ` (Task: ${task.title})`;
              }
              sub.appendChild(el('span', { text: '🔗 ' + wr.title + suffix, style: 'font-weight: 500;' }));
              cell.appendChild(sub);
            }
          }
          return cell;
        }
      },
      { key: 'amount', label: 'Amount', render: (d) => formatPHP(d.amount || 0), align: 'right', width: '100px' },
      {
        key: 'fund',
        label: 'Fund',
        width: '110px',
        render: (d) => {
          const source = this.getFundSource(d);
          return el('span', { class: 'badge ' + (source === 'Firm Fund' ? 'badge-info' : 'badge-warning'), text: source });
        }
      },
      { key: 'status', label: 'Status', render: (d) => this.statusBadge(d.status), width: '120px' },
      { key: 'paymentMethod', label: 'Payment Method', render: (d) => (d.status === 'Released' && d.paymentDetails?.method) ? d.paymentDetails.method : '—', width: '130px' },
      { key: 'submittedAt', label: 'Date', render: (d) => formatDate(d.submittedAt), width: '110px' },
      { key: 'actions', label: 'Actions', render: (d) => buildActions(d), class: 'dt-actions-col', width: '180px' }
    ];

    const tableView = DataTable.render({
      items,
      columns,
      selectable: true,
      bulkActions: () => [],
      rowId: (d) => d.id,
      onRowClick: (d) => {
        if (this._isTempId(d.id)) return;
        location.hash = '#disbursement/detail/' + d.id;
      }
    });

    container.appendChild(tableView);
  },

  /**
   * Role-aware board columns for Disbursement.
   *
   * - Admin: Draft | Released | Funded | Rejected
   *   Pending/Approved/Release Pending Approval are funnelled to the Admin Console.
   * - Accounting: Draft | Pending | Released | Funded | Rejected
   *   Approved/Release Pending Approval are funnelled to the Admin Console / handler list.
   * - Operations: Requested | Released | Funded | Rejected
   *   Draft is hidden; Pending maps the pre-approval statuses.
   * - Others: Released | Funded | Rejected
   */
  getBoardColumns() {
    const departments = Auth.user?.departments || [];
    const role = Auth.user?.role;
    const isAdmin = role === 'Admin';
    const isAccounting = departments.includes('Accounting');
    const isOperations = departments.includes('Operations');

    if (isAdmin || isAccounting) {
      return [
        { key: 'Draft', label: 'Draft', statuses: ['Draft'], targetStatus: 'Draft', color: '#94a3b8' },
        { key: 'Pending', label: 'Pending', statuses: this.PENDING_APPROVAL_STATUSES, targetStatus: 'Pending', color: '#f59e0b' },
        { key: 'Released', label: 'Released', statuses: ['Released'], targetStatus: 'Released', color: '#10b981' },
        { key: 'Funded', label: 'Funded', statuses: ['Funded'], targetStatus: 'Funded', color: '#059669' },
        { key: 'Rejected', label: 'Rejected', statuses: ['Rejected'], targetStatus: 'Rejected', color: '#ef4444' }
      ];
    }

    if (isOperations) {
      return [
        { key: 'Draft', label: 'Draft', statuses: ['Draft'], targetStatus: 'Draft', color: '#94a3b8' },
        { key: 'Requested', label: 'Requested', statuses: this.PENDING_APPROVAL_STATUSES, targetStatus: 'Pending', color: '#f59e0b' },
        { key: 'Released', label: 'Released', statuses: ['Released'], targetStatus: 'Released', color: '#10b981' },
        { key: 'Funded', label: 'Funded', statuses: ['Funded'], targetStatus: 'Funded', color: '#059669' },
        { key: 'Rejected', label: 'Rejected', statuses: ['Rejected'], targetStatus: 'Rejected', color: '#ef4444' }
      ];
    }

    return [
      { key: 'Draft', label: 'Draft', statuses: ['Draft'], targetStatus: 'Draft', color: '#94a3b8' },
      { key: 'Pending', label: 'Pending', statuses: this.PENDING_APPROVAL_STATUSES, targetStatus: 'Pending', color: '#f59e0b' },
      { key: 'Released', label: 'Released', statuses: ['Released'], targetStatus: 'Released', color: '#10b981' },
      { key: 'Funded', label: 'Funded', statuses: ['Funded'], targetStatus: 'Funded', color: '#059669' },
      { key: 'Rejected', label: 'Rejected', statuses: ['Rejected'], targetStatus: 'Rejected', color: '#ef4444' }
    ];
  },

  getDisbursementDisplayStatus(status) {
    if (status === 'Released') return 'Released';
    if (status === 'Funded') return 'Funded';
    return status;
  },

  renderBoardView(container, items, groupBy = 'none', groupOptions = [], toolbarContainer = null) {
    toolbarContainer?.classList.remove('grouped-board-active');
    if (items.length === 0) {
      container.appendChild(renderEmptyStateV2({
        variant: 'zero-state',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        title: 'No expenses found',
        body: 'Create an expense to start tracking disbursements.'
      }));
      return;
    }

    const canEdit = Auth.can('disbursement:edit');
    const canCreate = Auth.can('disbursement:create');
    const canDelete = Auth.can('disbursement:delete');
    const self = this;

    items.forEach(d => { d.isOptimistic = self._isTempId(d.id); });

    const boardPhases = this.getBoardColumns();
    const statusColors = {
      'Draft': '#94a3b8',
      'Submitted': '#f59e0b',
      'Under Review': '#f59e0b',
      'Pending': '#f59e0b',
      'Approved': '#3b82f6',
      'Released': '#10b981',
      'Funded': '#059669',
      'Rejected': '#ef4444'
    };

    // Normalize boardOrder within each visible column (skip pending-change proxies).
    const sortedItems = [];
    boardPhases.forEach(phase => {
      const colItems = items.filter(d => phase.statuses.includes(d.status) && !d.pendingChangeId && !d.archived && d.status !== 'Cancelled');
      colItems.sort((a, b) => {
        const oa = typeof a.boardOrder === 'number' ? a.boardOrder : null;
        const ob = typeof b.boardOrder === 'number' ? b.boardOrder : null;
        if (oa !== null && ob !== null) return oa - ob;
        if (oa !== null) return -1;
        if (ob !== null) return 1;
        return new Date(a.createdAt || a.submittedAt || 0) - new Date(b.createdAt || b.submittedAt || 0);
      });
      colItems.forEach((d, idx) => {
        if (this._isTempId(d.id) || d.status === 'Cancelled' || d.archived) return;
        const newOrder = (idx + 1) * 1000;
        if (d.boardOrder !== newOrder) {
          d.boardOrder = newOrder;
          window.apiClient.disbursements.update(d.id, { boardOrder: newOrder }).catch(e => {
            if (e.status === 404 || e.statusCode === 404 || e.message?.includes('404') || e.message?.includes('not found') || e.message === 'route-change' || e.message?.includes('aborted')) {
              return;
            }
            console.error('Failed to update disbursement board order', d.id, e);
          });
        }
      });
      const colPendingItems = items.filter(d => phase.statuses.includes(d.status) && d.pendingChangeId);
      sortedItems.push(...colItems, ...colPendingItems);
    });

    const makeColumns = () => boardPhases.map(phase => {
      const col = {
        ...phase,
        icon: 'phase',
        emptyState: { variant: 'compact', title: 'No expenses', body: '' }
      };
      if (phase.key === 'Draft' && canCreate) {
        col.addButton = { label: 'Add Expense', onClick: () => self.showForm() };
      }
      return col;
    });

    const sortedForSeq = [...items].sort((a, b) => sortByDate(a, b, 'createdAt'));
    const seqMap = new Map(sortedForSeq.map((d, i) => [d.id, i + 1]));

    const renderCard = (d) => {
      const emp = window.apiClient.userCache.getById(self.getEmployeeId(d));
      const source = self.getFundSource(d);

      const statusPriorityClass = {
        'Draft': 'card-v2-priority-normal',
        'Submitted': 'card-v2-priority-medium',
        'Under Review': 'card-v2-priority-medium',
        'Pending': 'card-v2-priority-medium',
        'Approved': 'card-v2-priority-medium',
        'Released': 'card-v2-priority-low',
        'Funded': 'card-v2-priority-low',
        'Rejected': 'card-v2-priority-urgent'
      }[d.status] || 'card-v2-priority-normal';

      const progressMap = {
        'Draft': 0,
        'Submitted': 15,
        'Under Review': 25,
        'Pending': 35,
        'Approved': 50,
        'Released': 100,
        'Funded': 100,
        'Rejected': 0
      };
      const progress = progressMap[d.status] || 0;

      const descParts = [];
      if (d.linkedWorkRequestId) {
        const wr = window.apiClient.workRequestCache.getById(d.linkedWorkRequestId);
        if (wr) {
          let linked = wr.title;
          if (d.linkedTaskId) {
            const task = (wr.tasks || []).find(t => t.id === d.linkedTaskId);
            if (task) linked += ` (Task: ${task.title})`;
          }
          descParts.push(linked);
        }
      }
      if (d.fromTemplate) descParts.push('Recurring');

      const card = buildCompactBoardCard({
        key: 'DIS-' + (seqMap.get(d.id) || 1),
        progress,
        statusColor: statusColors[d.status] || '#cbd5e1',
        title: d.category,
        description: `${emp?.name || '—'} • ${source}`,
        detail: descParts.join(' • '),
        date: d.submittedAt ? formatDate(d.submittedAt) : '',
        priority: self.getDisbursementDisplayStatus(d.status),
        priorityClass: statusPriorityClass,
        onClick: () => {
          if (self._isTempId(d.id)) return;
          location.hash = '#disbursement/detail/' + d.id;
        }
      });

      const footerRight = card.querySelector('.card-v2-footer-right');
      footerRight.appendChild(el('div', { class: 'card-v2-footer-item', text: formatPHP(d.amount), style: 'font-weight:700;color:var(--color-text);' }));
      if (d.isOptimistic) {
        card.classList.add('board-card-optimistic');
        card.style.opacity = '0.8';
        card.style.cursor = 'not-allowed';
      }
      return card;
    };

    const cardMenuItems = (d) => {
      const menu = [{
        label: 'View Details',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        onClick: () => { location.hash = '#disbursement/detail/' + d.id; }
      }];
      if (canEdit && d.status === 'Draft' && !d.pendingChangeId && !self._isTempId(d.id)) {
        menu.push({
          label: 'Edit',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
          onClick: () => self.showForm(d.id)
        });
      }
      if (canDelete && !d.pendingChangeId && !self._isTempId(d.id) && !d.archived) {
        menu.push({
          label: 'Trash',
          className: 'danger',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
          onClick: () => self.trashDisbursement(d.id)
        });
      }
      if (canCreate && d.status === 'Draft' && !d.pendingChangeId && !self._isTempId(d.id)) {
        menu.push({
          label: 'Submit Expense',
          className: 'primary',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M19 12l-4-4m4 4l-4 4"/></svg>',
          onClick: () => Workflow.showConfirm('Submit Expense', 'Are you sure you want to submit this expense for approval?', async () => {
            try {
              await self._optimisticUpdate(d.id, { status: 'Pending' }, () => window.apiClient.disbursements.submit(d.id), 'Submit Failed');
            } catch (e) {
              // Error surfaced by _optimisticUpdate.
            }
          }, 'success')
        });
      }
      if (d.status === 'Funded' && !d.archived && !self._isTempId(d.id)) {
        menu.push({
          label: 'Archive',
          className: 'primary',
          icon: ArchivePage.icons.archive,
          onClick: () => self.archiveDisbursement(d.id)
        });
      }
      return menu;
    };

    const boardDrag = {
      enabled: true,
      canDrag: d => {
        if (self._isTempId(d.id)) return false;
        const canManage = canEdit || Auth.can('disbursement:approve') || Auth.can('disbursement:mark_released') || Auth.isManagerial();
        return canManage && !d.pendingChangeId;
      },
      canDrop: ({ item, targetStatus, beforeItem, afterItem }) => {
        if (beforeItem && self._isTempId(beforeItem.id)) return false;
        if (afterItem && self._isTempId(afterItem.id)) return false;
        if (item.status === targetStatus) return true;
        // Map pre-approval statuses to the canonical Pending step.
        const preApproval = ['Submitted', 'Under Review', 'Pending'];
        const effectiveStatus = preApproval.includes(item.status) ? 'Pending' : item.status;
        const flow = ['Draft', 'Pending', 'Approved', 'Released', 'Funded'];
        const currentIdx = flow.indexOf(effectiveStatus);
        const targetIdx = flow.indexOf(targetStatus);
        if (currentIdx === -1 || targetIdx === -1) return false;
        return targetIdx > currentIdx;
      },
      orderField: 'boardOrder',
      onDrop({ item, targetStatus, newOrder, fromStatus }) {
        if (self._isTempId(item.id)) {
          Workflow.showMessage('Saving...', 'Please wait for the disbursement to finish saving before moving it.', 'info');
          return;
        }
        if (fromStatus === targetStatus) {
          window.apiClient.disbursements.update(item.id, { boardOrder: newOrder }).then(() => App.handleRoute()).catch(e => {
            console.error('Failed to update board order', e);
            Workflow.showMessage('Update Failed', e.message || 'Unable to move disbursement.', 'error');
          });
          return;
        }

        // Permission gate: Approved requires disbursement:approve
        if (targetStatus === 'Approved' && !Auth.can('disbursement:approve')) {
          Workflow.showMessage('Permission Denied', 'Only users with approval rights can approve disbursements.', 'danger');
          return;
        }

        // Permission gate: Released requires mark_released or approve
        if (targetStatus === 'Released' && !Auth.can('disbursement:mark_released') && !Auth.can('disbursement:approve')) {
          Workflow.showMessage('Permission Denied', 'You do not have permission to release disbursements.', 'danger');
          return;
        }

        // Block if pending admin approval
        if (item.pendingChangeId) {
          Workflow.showMessage('Pending Approval', 'This disbursement is pending administrative approval and cannot be moved.', 'warning');
          return;
        }

        // Block Draft → beyond Pending if no amount
        if (fromStatus === 'Draft' && targetStatus !== 'Pending' && (!item.amount || item.amount <= 0)) {
          Workflow.showMessage('Incomplete Disbursement', 'Cannot advance — disbursement has no amount specified.', 'warning');
          return;
        }

        const label = item.category + ' — ' + formatPHP(item.amount);
        const applyMove = async () => {
          if (targetStatus === 'Released') {
            self.showReleaseDialog(item.id);
            return;
          }
          const patch = targetStatus === 'Pending' ? { status: 'Pending' }
            : targetStatus === 'Approved' ? { status: 'Approved' }
            : targetStatus === 'Funded' ? { status: 'Funded' }
            : { status: targetStatus, boardOrder: newOrder };
          try {
            await self._optimisticUpdate(item.id, patch, () => {
              if (targetStatus === 'Pending') {
                return window.apiClient.disbursements.submit(item.id);
              } else if (targetStatus === 'Approved') {
                return window.apiClient.disbursements.approve(item.id);
              } else if (targetStatus === 'Funded') {
                return window.apiClient.disbursements.fund(item.id);
              } else {
                return window.apiClient.disbursements.update(item.id, { boardOrder: newOrder, status: targetStatus });
              }
            }, 'Update Failed');
          } catch (e) {
            // Error surfaced by _optimisticUpdate.
          }
        };

        // Confirm critical transitions
        if (['Approved', 'Released', 'Funded'].includes(targetStatus)) {
          const msgs = {
            'Approved': `Approve disbursement "${label}"?`,
            'Released': `Release disbursement "${label}"? This will open the release dialog to record payment details.`,
            'Funded': `Mark disbursement "${label}" as Funded? This confirms funds have been credited.`
          };
          Workflow.showConfirm('Confirm Status Change', msgs[targetStatus], applyMove, 'success');
          return;
        }

        applyMove();
      }
    };

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
        storageKey: 'erp_disbursement_grouped_collapsed',
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
    items.forEach(d => {
      const emp = window.apiClient.userCache.getById(this.getEmployeeId(d));
      const item = el('div', { class: 'list-item', style: 'cursor: pointer;' });
      item.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input, select')) return;
        if (this._isTempId(d.id)) return;
        location.hash = '#disbursement/detail/' + d.id;
      });
      const left = el('div');
      const titleRow = el('div', { class: 'list-item-title' });
      titleRow.appendChild(document.createTextNode(d.category + ' — ' + formatPHP(d.amount)));
      if (d.fromTemplate) {
        titleRow.appendChild(document.createTextNode(' '));
        titleRow.appendChild(this.recurringBadge(d));
      }
      left.appendChild(titleRow);
      let wrMeta = '';
      if (d.linkedWorkRequestId) {
        const wr = window.apiClient.workRequestCache.getById(d.linkedWorkRequestId);
        if (wr) {
          wrMeta = ' • WR: ' + wr.title;
          if (d.linkedTaskId) {
            const task = (wr.tasks || []).find(t => t.id === d.linkedTaskId);
            if (task) wrMeta += ` (Task: ${task.title})`;
          } else {
            wrMeta += ' (Entire WR)';
          }
        }
      }
      left.appendChild(el('div', { class: 'list-item-meta', text: (emp?.name || '—') + ' • ' + this.getFundSource(d) + ' • ' + formatDate(d.submittedAt) + wrMeta }));
      item.appendChild(left);
      const actionWrap = el('div', { style: 'display:flex;gap:4px;align-items:center;flex-shrink:0;' });
      if (!this._isTempId(d.id) && this.canEditDisbursement(d)) {
        const editBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Edit' });
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showForm(d.id); });
        actionWrap.appendChild(editBtn);
      }
      item.appendChild(actionWrap);
      list.appendChild(item);
    });
    container.appendChild(list);
  },

  // ============================================================
  // Expense Filing Form
  // ============================================================
  async renderForm(opts = {}) {
    const { hideHeader = false, existing = null } = opts;
    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure()
    ]);
    // Allow access if user can create new disbursements OR can edit existing ones
    const isNew = !this.detailId;
    if (isNew && !Auth.can('disbursement:create')) {
      this.view = 'list';
      App.handleRoute();
      return el('div');
    }
    if (!isNew && !Auth.can('disbursement:create') && !Auth.can('disbursement:edit')) {
      this.view = 'list';
      App.handleRoute();
      return el('div');
    }

    const entity = Auth.activeEntity;
    const opReq = this._prefilledOpReq || null;
    const prefill = this.prefilledWrId ? { workRequestId: this.prefilledWrId, clientId: this.prefilledClientId } : 
                    (opReq ? { workRequestId: opReq.workRequestId || opReq.work_request_id, clientId: opReq.clientId || opReq.client_id, linkedTaskId: opReq.linkedTaskId || opReq.linked_task_id } : null);

    const container = el('div');

    if (!hideHeader) {
      const headerBar = el('div', { class: 'form-header-bar' });
      const headerActions = el('div', { class: 'form-actions-top' });
      const saveBtnTop = el('button', { type: 'submit', form: 'disbursement-form', class: 'btn btn-primary', text: isNew ? 'Submit Expense' : 'Save Changes' });
      headerActions.appendChild(saveBtnTop);
      const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel' });
      cancelBtn.addEventListener('click', () => closeFormPanelAndRoute('#disbursement'));
      headerActions.appendChild(cancelBtn);
      headerBar.appendChild(headerActions);
      container.appendChild(headerBar);
    }

    const form = el('form', { class: 'form-stacked notion-form', id: 'disbursement-form' });

    // ── Top property grid ──
    const propsGrid = el('div', { class: 'notion-property-grid' });

    // Category
    const catGroup = el('div', { class: 'notion-prop' });
    catGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg> Category' }));
    
    const OTHER_CATEGORY = 'Other';
    const standardCategories = this.STANDARD_CATEGORIES;
    let initialCategory = '';
    if (existing) {
      initialCategory = existing.category;
    } else if (opReq) {
      initialCategory = opReq.category;
    }
    const isCustom = initialCategory && !standardCategories.includes(initialCategory);

    const catSel = el('select', { required: true, class: 'notion-prop-select' });
    standardCategories.forEach(c => {
      const opt = el('option', { value: c, text: c });
      if (isCustom) {
        if (c === OTHER_CATEGORY) opt.selected = true;
      } else {
        if (initialCategory === c) opt.selected = true;
      }
      catSel.appendChild(opt);
    });

    let previousSelection;
    if (isCustom) {
      previousSelection = OTHER_CATEGORY;
    } else if (initialCategory && initialCategory !== OTHER_CATEGORY) {
      previousSelection = initialCategory;
    } else {
      previousSelection = catSel.value;
    }

    const catInput = el('input', {
      type: 'text',
      placeholder: 'Enter custom category...',
      class: 'notion-prop-input',
      value: isCustom ? initialCategory : ''
    });

    const backBtn = el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-sm',
      text: 'Back'
    });

    const inputWrapper = el('div', {
      class: 'notion-input-with-btn'
    });
    inputWrapper.appendChild(catInput);
    inputWrapper.appendChild(backBtn);

    const switchToCustomInput = () => {
      catSel.style.display = 'none';
      catSel.removeAttribute('name');
      catSel.required = false;

      inputWrapper.style.display = 'flex';
      catInput.setAttribute('name', 'category');
      catInput.required = true;
    };

    const switchToDropdown = () => {
      inputWrapper.style.display = 'none';
      catInput.removeAttribute('name');
      catInput.required = false;

      catSel.style.display = '';
      catSel.setAttribute('name', 'category');
      catSel.required = true;
    };

    if (isCustom) {
      switchToCustomInput();
    } else {
      switchToDropdown();
    }

    catSel.addEventListener('change', () => {
      if (catSel.value === OTHER_CATEGORY) {
        switchToCustomInput();
        catInput.focus();
      } else {
        previousSelection = catSel.value;
      }
    });

    backBtn.addEventListener('click', () => {
      switchToDropdown();
      catSel.value = previousSelection;
    });

    catGroup.appendChild(catSel);
    catGroup.appendChild(inputWrapper);
    propsGrid.appendChild(catGroup);

    // Linked Work Request
    const wrGroup = el('div', { class: 'notion-prop' });
    wrGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg> Work Request' }));
    const wrSelAttrs = { name: 'linkedWorkRequestId', class: 'notion-prop-select' };
    if (prefill) wrSelAttrs.disabled = true;
    const wrSel = el('select', wrSelAttrs);
    wrSel.appendChild(el('option', { value: '', text: '— None —' }));
    const formWrs = window.apiClient.workRequestCache._wrs || [];
    formWrs.filter(wr => matchesEntity(wr.entity, entity)).forEach(wr => {
      const client = window.apiClient.clientCache.getById(wr.clientId);
      const opt = el('option', { value: wr.id, text: wr.title + ' — ' + (client?.name || '—') });
      if (existing && existing.linkedWorkRequestId === wr.id) opt.selected = true;
      else if (!existing && prefill && prefill.workRequestId === wr.id) opt.selected = true;
      wrSel.appendChild(opt);
    });
    wrGroup.appendChild(wrSel);
    if (prefill && prefill.workRequestId) wrGroup.appendChild(el('input', { type: 'hidden', name: 'linkedWorkRequestId', value: prefill.workRequestId }));
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

    // Amount
    const amtGroup = el('div', { class: 'notion-prop' });
    amtGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Amount (₱)' }));
    amtGroup.appendChild(el('input', { type: 'number', name: 'amount', class: 'notion-prop-input', min: 0, step: 0.01, required: true, value: existing ? String(existing.amount) : (opReq ? String(opReq.amount) : '') }));
    propsGrid.appendChild(amtGroup);

    // Fund Source
    const fundGroup = el('div', { class: 'notion-prop' });
    fundGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Fund Source' }));
    const fundWrap = el('div', { class: 'radio-group notion-radio-group' });
    ['Firm Fund', 'Client Fund'].forEach(f => {
      const label = el('label', { class: 'radio-label' });
      const radio = el('input', { type: 'radio', name: 'fundSource', value: f, required: true });
      if (existing ? existing.fundSource === f : f === 'Firm Fund') radio.checked = true;
      label.appendChild(radio);
      label.appendChild(document.createTextNode(' ' + f));
      fundWrap.appendChild(label);
    });
    fundGroup.appendChild(fundWrap);
    propsGrid.appendChild(fundGroup);

    form.appendChild(propsGrid);

    // Description free-form
    const descSection = el('div', { class: 'notion-freeform' });
    descSection.appendChild(el('label', { class: 'notion-section-label', text: 'Description' }));
    const descInput = el('input', { type: 'text', name: 'description', class: 'notion-freeform-input', placeholder: 'What is this expense for?', required: true, value: existing ? (existing.description || '') : (opReq ? (opReq.notes || 'Operations Disbursement Request') : '') });
    descSection.appendChild(descInput);
    form.appendChild(descSection);

    // Receipt upload
    const receiptGroup = el('div', { class: 'notion-freeform' });
    receiptGroup.appendChild(el('label', { class: 'notion-section-label', text: 'Receipt' }));
    receiptGroup.appendChild(el('input', { type: 'file', name: 'receipt', class: 'notion-file-input' }));
    if (existing && existing.receiptFilename) {
      receiptGroup.appendChild(el('p', { text: 'Current: ' + existing.receiptFilename, style: 'font-size:0.75rem;color:var(--color-text-muted);' }));
    } else if (!existing && opReq && opReq.receiptFilename) {
      receiptGroup.appendChild(el('p', { text: 'Requested receipt: ' + opReq.receiptFilename, style: 'font-size:0.75rem;color:var(--color-text-muted);' }));
    }
    form.appendChild(receiptGroup);

    const updateTasks = () => {
      while (taskSel.firstChild) taskSel.removeChild(taskSel.firstChild);
      taskSel.appendChild(el('option', { value: '', text: '— Whole Project —' }));
      const wrId = wrSel.value;
      if (wrId) {
        const wr = window.apiClient.workRequestCache.getById(wrId);
        (wr?.tasks || []).forEach(t => {
          const opt = el('option', { value: t.id, text: t.title });
          if (existing && existing.linkedTaskId === t.id) opt.selected = true;
          else if (!existing && prefill && prefill.linkedTaskId === t.id) opt.selected = true;
          taskSel.appendChild(opt);
        });
      }
    };
    wrSel.addEventListener('change', updateTasks);
    updateTasks(); // Initial load

    // Linked invoice (only for Client Fund) — collapsible notion section
    const invGroup = el('div', { class: 'notion-collapsible hidden', id: 'linked-invoice-group' });
    const invToggle = el('div', { class: 'notion-toggle-header', text: 'Linked Billing Invoice' });
    const invBody = el('div', { class: 'notion-toggle-body' });
    const invSel = el('select', { name: 'linkedInvoiceId', class: 'notion-prop-select' });
    invSel.appendChild(el('option', { value: '', text: '— Select Invoice —' }));
    invBody.appendChild(invSel);
    invGroup.appendChild(invToggle);
    invGroup.appendChild(invBody);
    form.appendChild(invGroup);

    window.apiClient.invoices.list({ status: 'Draft,Sent,Partially Paid,Paid', limit: 200 }).then(res => {
      const invoices = (res.data || []).filter(inv => matchesEntity(inv.entity, entity) && inv.status !== 'Cancelled');
      invoices.forEach(inv => {
        const client = window.apiClient.clientCache.getById(inv.clientId);
        const opt = el('option', { value: inv.id, text: inv.invoiceNumber + ' — ' + (client?.name || '—') });
        if (existing && existing.linkedInvoiceId === inv.id) opt.selected = true;
        invSel.appendChild(opt);
      });
    }).catch(e => console.error('Failed to load invoices for disbursement form', e));

    invToggle.addEventListener('click', () => {
      invGroup.classList.toggle('open');
      invToggle.classList.toggle('collapsed');
    });

    form.querySelectorAll('input[name="fundSource"]').forEach(r => {
      r.addEventListener('change', () => {
        const isClient = form.querySelector('input[name="fundSource"]:checked')?.value === 'Client Fund';
        invGroup.classList.toggle('hidden', !isClient);
      });
    });
    const initialClientFund = existing && existing.fundSource === 'Client Fund';
    if (initialClientFund) invGroup.classList.remove('hidden');

    form.addEventListener('submit', e => { e.preventDefault(); this.submitForm(form).catch(err => console.error('submitForm error', err)); });

    container.appendChild(form);
    return container;
  },

  async submitForm(form) {
    if (!validateRequiredFields(form)) return;
    const isResubmitting = typeof PendingChanges !== 'undefined' && PendingChanges.editingPendingId;

    const data = Object.fromEntries(new FormData(form).entries());
    const entity = Auth.activeEntity;
    const receiptInput = form.querySelector('input[name="receipt"]');
    const receiptFile = receiptInput?.files?.[0];
    const isNew = !this.detailId;

    const amount = parseFloat(data.amount) || 0;
    if (amount <= 0) {
      Workflow.showMessage('Validation Error', 'Please enter a disbursement amount greater than zero.', 'warning');
      return;
    }

    const existing = isNew ? null : await this.loadDisbursement(this.detailId);

    // On create, a receipt must be attached (or already provided via a fulfilled operations request).
    const hasExistingReceipt = !isNew && (existing?.receiptFilename || null);
    const hasPrefilledReceipt = isNew && (this._prefilledOpReq?.receiptFilename || null);
    if (isNew && !receiptFile && !hasPrefilledReceipt) {
      Workflow.showMessage('Validation Error', 'Please attach a receipt for this disbursement.', 'warning');
      return;
    }

    const payload = {
      ...this.toApiPayload(data),
      clientId: this.prefilledClientId || null,
      employeeId: Auth.user.id
    };

    const targetRoute = isResubmitting ? '#admin' : '#disbursement';
    let record;

    if (isNew) {
      // Optimistic create: show the confirmation modal first, then persist the
      // server record once the API responds.
      const optimisticRecord = this._buildOptimisticDisbursement(payload);
      this._addOptimisticDisbursement(optimisticRecord, { skipRoute: true });
      const completedGen = this._activeSkipGeneration;

      const msgConfig = {
        title: 'Expense Submitted',
        message: 'Disbursement expense has been submitted successfully.',
        type: 'success'
      };
      await closeFormPanelAndRoute(targetRoute, msgConfig);

      try {
        const res = await window.apiClient.disbursements.create(payload);
        record = this.normalizeDisbursement(res.data);
        this._replaceOptimisticCreate(optimisticRecord.id, record);
        this._clearSkipGenerationIfCurrent(completedGen);
      } catch (e) {
        this._rollbackOptimisticCreate(optimisticRecord.id, e, 'Save Failed');
        this._clearSkipGenerationIfCurrent(completedGen);
        return;
      }
    } else {
      try {
        const res = await window.apiClient.disbursements.update(this.detailId, payload);
        record = this.normalizeDisbursement(res.data);
        this._detailCache[this.detailId] = record;
        this._updateCachedDisbursement(record.id, record);
        this._refreshCounts();
        this._invalidateDashboardCache();
      } catch (e) {
        console.error('Failed to save disbursement', e);
        Workflow.showMessage('Save Failed', e.message || 'Unable to save disbursement.', 'error');
        return;
      }

      const msgConfig = {
        title: 'Expense Updated',
        message: 'Disbursement expense has been updated successfully.',
        type: 'success'
      };
      closeFormPanelAndRoute(targetRoute, msgConfig);
      return;
    }

    // Fulfill pending operations request if any (only reached for new creates)
    try {
      let reqId = this.prefilledRequestId || null;
      if (!reqId && record.linkedWorkRequestId) {
        const opReqRes = await window.apiClient.operationsRequests.list({ status: 'pending', type: 'disbursement', workRequestId: record.linkedWorkRequestId, limit: 1 });
        reqId = (opReqRes.data || [])[0]?.id || null;
      }
      if (reqId) {
        await window.apiClient.operationsRequests.update(reqId, { status: 'fulfilled', fulfilledBy: Auth.user.id });
      }
    } catch (e) {
      console.error('Failed to fulfill disbursement operations request', e);
    }
    this.prefilledRequestId = null;
    this.prefilledWrId = null;
    this.prefilledClientId = null;
    this._prefilledOpReq = null;

    App.handleRoute();
  },

  async showRequestDisbursementModal() {
    await Promise.all([
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure()
    ]);
    const entity = Auth.activeEntity;
    let wrs = window.apiClient.workRequestCache._wrs || [];
    wrs = wrs.filter(wr => {
      const wrEnt = (wr.entity || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(wrEnt);
      return wrEnt === entity.toUpperCase();
    });

    wrs = wrs.filter(wr => Auth.canViewWr(wr));

    let pendingRequests = [];
    try {
      const pendingRes = await window.apiClient.operationsRequests.list({ status: 'pending', type: 'disbursement' });
      pendingRequests = pendingRes.data || [];
    } catch (e) {
      console.error('Failed to load pending disbursement requests', e);
    }
    const pendingWrIds = new Set(pendingRequests.map(r => r.work_request_id || r.workRequestId).filter(Boolean));

    const wrapper = el('div', { class: 'form-stacked', style: 'display: flex; flex-direction: column;' });
    const selectGroup = el('div', { class: 'form-group' });
    selectGroup.appendChild(el('label', { text: 'Select Work Request *' }));
    const wrSelect = el('select', { class: 'form-select', style: 'width:100%;' });
    wrSelect.appendChild(el('option', { value: '', text: '— Select —' }));
    wrs.forEach(wr => {
      const client = window.apiClient.clientCache.getById(wr.clientId);
      if (!pendingWrIds.has(wr.id)) {
        wrSelect.appendChild(el('option', { value: wr.id, text: `${wr.title} — ${client?.name || '—'}` }));
      }
    });
    selectGroup.appendChild(wrSelect);
    wrapper.appendChild(selectGroup);

    const notesGroup = el('div', { class: 'form-group' });
    notesGroup.appendChild(el('label', { text: 'Additional Notes (Optional)' }));
    notesGroup.appendChild(el('textarea', { id: 'disb-opreq-notes', class: 'form-control', style: 'width: 100%; min-height: 80px;', placeholder: 'Provide any details for Accounting staff...' }));
    wrapper.appendChild(notesGroup);

    wrapper.appendChild(el('div', { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;' }, [
      el('button', { id: 'btn-cancel-disb-opreq', class: 'btn btn-ghost', text: 'Cancel' }),
      el('button', { id: 'btn-save-disb-opreq', class: 'btn btn-primary', text: 'Submit Request' })
    ]));

    const overlay = Workflow.showModal('Request Disbursement', wrapper);

    overlay.querySelector('#btn-cancel-disb-opreq').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btn-save-disb-opreq').addEventListener('click', async () => {
      const wrId = wrSelect.value;
      if (!wrId) { alert('Please select a work request.'); return; }
      const wr = window.apiClient.workRequestCache.getById(wrId);
      const notes = overlay.querySelector('#disb-opreq-notes').value.trim();
      const record = {
        type: 'disbursement',
        workRequestId: wrId,
        clientId: wr?.clientId || null,
        amount: null,
        notes
      };
      try {
        await window.apiClient.operationsRequests.create(record);
        overlay.remove();
        Workflow.showMessage('Request Submitted', 'Your disbursement request has been submitted to Accounting for review.', 'success');
        App.handleRoute();
      } catch (err) {
        console.error('Failed to create disbursement request', err);
        Workflow.showMessage('Request Failed', err.message || 'Unable to submit disbursement request.', 'error');
      }
    });
  },

  // ============================================================
  // Detail View (with approval actions)
  // ============================================================
  async renderDetail() {
    const d = await this.loadDisbursement(this.detailId);
    if (!d) { location.hash = '#disbursement'; return el('div'); }

    // Warm the caches that Auth.canViewDisbursement needs to resolve linked
    // work-request ownership for the active entity. Without this, a navigation
    // from the consolidated dashboard after an entity switch could evaluate
    // permissions against an empty cache and incorrectly redirect to the list.
    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure(),
    ]);

    if (!Auth.canViewDisbursement(d)) {
      location.hash = '#disbursement';
      return el('div');
    }
    const emp = window.apiClient.userCache.getById(this.getEmployeeId(d));
    const wr = d.linkedWorkRequestId ? window.apiClient.workRequestCache.getById(d.linkedWorkRequestId) : null;
    const client = wr ? window.apiClient.clientCache.getById(wr.clientId) : null;

    const container = el('div', { class: 'invoice-detail' });

    // Breadcrumb handled by render()
    
    // Status and badges
    const statusWrap = el('div', { style: 'display:flex; gap:8px; align-items:center; margin-bottom: var(--spacing-lg);' });
    statusWrap.appendChild(this.statusBadge(d.status));
    if (d.fromTemplate) statusWrap.appendChild(this.recurringBadge(d));
    container.appendChild(statusWrap);

    // Meta Info
    const meta = el('div', { class: 'invoice-meta' });
    meta.appendChild(el('p', { text: 'Client: ' + (client?.name || '—') }));
    meta.appendChild(el('p', { text: 'Date Submitted: ' + formatDate(d.submittedAt) }));
    meta.appendChild(el('p', { text: 'Fund Source: ' + this.getFundSource(d) }));
    container.appendChild(meta);

    // Linked Work Request / Task info card
    if (d.linkedWorkRequestId) {
      const linkedWr = window.apiClient.workRequestCache.getById(d.linkedWorkRequestId);
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

        if (d.linkedTaskId) {
          const linkedTask = (linkedWr.tasks || []).find(t => t.id === d.linkedTaskId);
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

        linkCard.appendChild(el('div', {
          text: 'Status: ' + (linkedWr.status || '—'),
          style: 'margin-top:4px;color:#64748b;font-size:0.75rem;'
        }));
        container.appendChild(linkCard);
      }
    }

    // Items table (Single row for disbursement)
    const table = el('table', { class: 'data-table' });
    table.appendChild(el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Category' }),
        el('th', { text: 'Description' }),
        el('th', { text: 'Amount' })
      ])
    ]));
    const tbody = el('tbody');
    tbody.appendChild(el('tr', {}, [
      el('td', { text: d.category }),
      el('td', { text: d.description }),
      el('td', { text: formatPHP(d.amount) })
    ]));
    table.appendChild(tbody);
    container.appendChild(table);

    // Totals / Summary Box
    const totals = el('div', { class: 'invoice-totals' });
    totals.appendChild(el('div', { class: 'total-row total-grand' }, [
      el('span', { text: 'Total Amount:' }), 
      el('span', { text: formatPHP(d.amount) })
    ]));
    
    if (d.status === 'Released') {
      totals.appendChild(el('div', { class: 'total-row' }, [el('span', { text: 'Released:' }), el('span', { text: formatPHP(d.amount) })]));
      totals.appendChild(el('div', { class: 'total-row' }, [el('span', { text: 'Balance:' }), el('span', { text: formatPHP(0) })]));
    } else {
      totals.appendChild(el('div', { class: 'total-row' }, [el('span', { text: 'Status:' }), el('span', { text: 'Pending Release', style: 'color: #94a3b8;' })]));
    }
    container.appendChild(totals);

    // Payment details (shown if released)
    if (d.status === 'Released' && d.paymentDetails) {
      const payHist = el('div', { class: 'form-section' });
      payHist.appendChild(el('h3', { text: 'Payment Details' }));
      
      const pd = d.paymentDetails;
      const handler = d.paymentHandledBy ? window.apiClient.userCache.getById(d.paymentHandledBy) : null;
      
      const pCard = el('div', { class: 'card', style: 'margin-bottom:12px; padding:16px; border:1px solid #e2e8f0; border-radius: 12px;' });

      // Header row
      const header = el('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;' });
      const amtBlock = el('div');
      amtBlock.appendChild(el('span', { text: formatPHP(d.amount), style: 'display:block; font-weight:700; font-size:1.25rem; color:#1e293b; line-height:1.2;' }));
      amtBlock.appendChild(el('span', { text: formatDate(pd.date || d.releasedAt), style: 'display:block; font-size:0.75rem; color:#94a3b8; margin-top:2px;' }));
      header.appendChild(amtBlock);
      header.appendChild(this.methodIcon(pd.method));
      pCard.appendChild(header);

      pCard.appendChild(el('div', { style: 'height:1px; background:#e2e8f0; margin:0 0 12px;' }));

      const rows = el('div', { style: 'display:flex; flex-direction:column; gap:6px;' });
      const addRow = (label, value) => {
        if (!value) return;
        const row = el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline; font-size:0.8125rem;' });
        row.appendChild(el('span', { text: label, style: 'color:#94a3b8; font-weight:500;' }));
        row.appendChild(el('span', { text: value, style: 'color:#334155; font-weight:600; text-align:right;' }));
        rows.appendChild(row);
      };

      if (pd.reference) addRow('Reference', pd.reference);
      if (pd.bank) addRow('Bank', pd.bank);
      addRow('Requested By', emp ? emp.name : '—');
      addRow('Released By', handler ? handler.name : '—');

      pCard.appendChild(rows);
      payHist.appendChild(pCard);
      container.appendChild(payHist);
    }

    // Approval Actions
    const canApprove = Auth.can('disbursement:approve');
    const isPending = this.PENDING_APPROVAL_STATUSES.includes(d.status);

    if (isPending && canApprove) {
      const isRequester = Auth.isSelfApprover(this.getEmployeeId(d));
      if (isRequester) {
        container.appendChild(el('p', { class: 'field-error', text: 'You cannot approve your own expense. Wait for another Admin.' }));
      } else {
        const actions = el('div', { class: 'form-actions', style: 'margin-top: var(--spacing-xl); border-top: 1px solid #e2e8f0; padding-top: var(--spacing-lg);' });

        const approveBtn = el('button', { class: 'btn btn-success', text: 'Approve Expense' });
        approveBtn.addEventListener('click', () => {
          this.showApproveDialog(d.id);
        });
        actions.appendChild(approveBtn);

        const rejectBtn = el('button', { class: 'btn btn-danger', text: 'Reject', style: 'margin-left: 8px;' });
        rejectBtn.addEventListener('click', () => {
          Workflow.showConfirm('Reject Expense', 'Are you sure you want to reject this request?', async () => {
            const reason = prompt('Enter rejection reason:');
            if (!reason) return;
            try {
              await this.reject(d.id, reason);
              App.handleRoute();
            } catch (e) {
              // error surfaced by reject()
            }
          }, 'danger');
        });
        actions.appendChild(rejectBtn);
        container.appendChild(actions);
      }
    } else if (d.status === 'Approved' && (Auth.can('disbursement:mark_released') || Auth.can('disbursement:approve'))) {
      const actions = el('div', { class: 'form-actions', style: 'margin-top: var(--spacing-xl); border-top: 1px solid #e2e8f0; padding-top: var(--spacing-lg);' });
      const releaseBtn = el('button', { class: 'btn btn-primary', text: 'Authorize & Release Funds' });
      releaseBtn.addEventListener('click', () => { this.showReleaseDialog(d.id); });
      actions.appendChild(releaseBtn);
      container.appendChild(actions);
    } else if (d.status === 'Released' && (canApprove || Auth.can('disbursement:release') || Auth.user?.departments?.includes('Accounting'))) {
      // Final funding step after release.
      const actions = el('div', { class: 'form-actions', style: 'margin-top: var(--spacing-xl); border-top: 1px solid #e2e8f0; padding-top: var(--spacing-lg);' });
      const fundBtn = el('button', { class: 'btn btn-success', text: 'Mark as Funded' });
      fundBtn.addEventListener('click', () => {
        Workflow.showConfirm('Mark as Funded', `Confirm that funds for "${d.category}" have been credited?`, async () => {
          try {
            await this._optimisticUpdate(d.id, { status: 'Funded' }, () => window.apiClient.disbursements.fund(d.id), 'Fund Failed');
            Workflow.showMessage('Funded', 'Disbursement marked as funded.', 'success');
          } catch (e) {
            // Error surfaced by _optimisticUpdate.
          }
        }, 'success');
      });
      actions.appendChild(fundBtn);
      container.appendChild(actions);
    } else if (d.status === 'Funded' && !d.archived) {
      const actions = el('div', { class: 'form-actions', style: 'margin-top: var(--spacing-xl); border-top: 1px solid #e2e8f0; padding-top: var(--spacing-lg);' });
      const archiveBtn = el('button', { class: 'btn btn-primary', text: 'Archive Disbursement', style: 'margin-right:8px;' });
      archiveBtn.addEventListener('click', () => this.archiveDisbursement(d.id));
      actions.appendChild(archiveBtn);
      container.appendChild(actions);
    }

    return container;
  },

  async showApproveDialog(id) {
    const d = await this.loadDisbursement(id);
    if (!d) return;
    if (!this.PENDING_APPROVAL_STATUSES.includes(d.status)) {
      Workflow.showMessage('Error', 'This disbursement is not pending approval.', 'danger');
      return;
    }
    if (Auth.isSelfApprover(this.getEmployeeId(d))) {
      Workflow.showMessage('Conflict', 'You cannot approve your own expense.', 'warning');
      return;
    }

    Workflow.showConfirm('Approve Expense', `Approve disbursement "${d.category}" (${formatPHP(d.amount)})?`, async () => {
      try {
        await this._optimisticUpdate(id, { status: 'Approved' }, () => window.apiClient.disbursements.approve(id), 'Approval Failed');
      } catch (e) {
        // Error surfaced by _optimisticUpdate.
      }
    }, 'success');
  },

  async showReleaseDialog(id, adminRelease) {
    const d = await this.loadDisbursement(id);
    if (!d) return;
    if (adminRelease && !Auth.can('disbursement:approve')) {
      Workflow.showMessage('Unauthorized', 'You do not have permission to approve release requests.', 'danger');
      return;
    }
    // Admin release flow: status is 'Release Pending Approval' (Manager marked for release)
    const validStatuses = adminRelease ? ['Approved', 'Release Pending Approval'] : ['Approved'];
    if (!validStatuses.includes(d.status)) {
      Workflow.showMessage('Error', 'This disbursement is not approved for release.', 'danger');
      return;
    }
    if (!adminRelease && d.paymentHandledBy !== Auth.user.id) {
      Workflow.showMessage('Unauthorized', 'You are not assigned to release this disbursement.', 'danger');
      return;
    }

    const form = el('form', { class: 'form-stacked' });

    const methodGroup = el('div', { class: 'form-group' });
    methodGroup.appendChild(el('label', { text: 'Payment Method *' }));
    const methodSel = el('select', { name: 'method', required: true, class: 'form-select' });
    ['Cash', 'Check', 'Bank Transfer', 'GCash', 'Maya', 'Other Digital'].forEach(m => methodSel.appendChild(el('option', { value: m, text: m })));
    methodGroup.appendChild(methodSel);
    form.appendChild(methodGroup);

    const refGroup = el('div', { class: 'form-group' });
    refGroup.appendChild(el('label', { text: 'Reference / Check Number *' }));
    refGroup.appendChild(el('input', { type: 'text', name: 'reference', required: true }));
    form.appendChild(refGroup);

    const dateGroup = el('div', { class: 'form-group' });
    dateGroup.appendChild(el('label', { text: 'Date of Release *' }));
    dateGroup.appendChild(el('input', { type: 'date', name: 'date', required: true, value: new Date().toISOString().slice(0, 10) }));
    form.appendChild(dateGroup);

    // Document Requirement
    const docGroup = el('div', { class: 'form-group' });
    docGroup.appendChild(el('label', { text: 'Attached Scanned Document (Required) *' }));
    docGroup.appendChild(el('input', { type: 'file', name: 'releaseDoc', required: true }));
    form.appendChild(docGroup);

    const submitBtn = el('button', { type: 'submit', class: 'btn btn-success', text: 'Confirm & Release Funds' });
    form.appendChild(submitBtn);

    const overlay = Workflow.showModal('Authorize Fund Release', form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateRequiredFields(form)) return;
      const fd = new FormData(form);
      const file = form.querySelector('input[name="releaseDoc"]').files[0];

      try {
        await this.release(id, {
          method: fd.get('method'),
          reference: fd.get('reference'),
          date: fd.get('date'),
          filename: file?.name || 'Authorized_Release.pdf'
        });
        overlay.remove();
        Workflow.showMessage('Released', 'Disbursement has been released.', 'success');
      } catch (e) {
        // error surfaced by release()
      }
    });
  },

  async release(id, pd) {
    const patch = {
      status: 'Released',
      releasedBy: Auth.user?.id || null,
      releasedAt: pd.date || new Date().toISOString(),
      paymentHandledBy: Auth.user?.id || null,
      paymentDetails: {
        method: pd.method,
        reference: pd.reference,
        bank: pd.bank || '',
        date: pd.date,
        processedBy: Auth.user?.id || null
      },
      releaseFilename: pd.filename || null
    };
    return this._optimisticUpdate(id, patch, () => window.apiClient.disbursements.release(id, {
      method: pd.method,
      reference: pd.reference,
      bank: pd.bank,
      date: pd.date
    }), 'Release Failed');
  },

  async reject(id, reason) {
    const patch = {
      status: 'Rejected',
      rejectionReason: reason,
      rejectedBy: Auth.user?.id || null,
      rejectedAt: new Date().toISOString()
    };
    return this._optimisticUpdate(id, patch, () => window.apiClient.disbursements.reject(id, { reason }), 'Reject Failed');
  },

  // ============================================================
  // Expense PDF & Voucher Generation (adopts billing.js format)
  // ============================================================
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

  _getSanitizedViewModel(d) {
    const emp = window.apiClient.userCache.getById(this.getEmployeeId(d));
    const requester = window.apiClient.userCache.getById(d.requestedBy);
    let approverId = d.approvedBy || d.accountingApprovedBy;
    if (!approverId && (d.status === 'Approved' || d.status === 'Released')) {
      const adminUser = (window.apiClient.userCache._users || []).find(u => u.role === 'Admin' || (u.departments || []).includes('Management'));
      if (adminUser) approverId = adminUser.id;
    }
    const approver = approverId ? window.apiClient.userCache.getById(approverId) : null;
    const handler = d.paymentHandledBy ? window.apiClient.userCache.getById(d.paymentHandledBy) : null;
    const releaser = d.releasedBy ? window.apiClient.userCache.getById(d.releasedBy) : null;
    const wr = d.linkedWorkRequestId ? window.apiClient.workRequestCache.getById(d.linkedWorkRequestId) : null;

    return {
      empName: escapeHtml(emp?.name || '—'),
      requesterEmail: escapeHtml(requester?.email || '—'),
      requesterName: escapeHtml(requester?.name || '—'),
      wrTitle: escapeHtml(wr?.title || '—'),
      category: escapeHtml(d.category || '—'),
      description: escapeHtml(d.description || '—'),
      approverName: escapeHtml(approver?.name || '—'),
      releaserName: escapeHtml(releaser ? releaser.name : (handler ? handler.name : '________________________')),
      receiptFilename: escapeHtml(d.receiptFilename || '_________________'),
      releaseFilename: escapeHtml(d.releaseFilename || '_________________'),
      approver,
      handler,
      releaser,
      wr,
      emp
    };
  },

  generateExpensePDF(d, noLogo = false) {
    const safe = this._getSanitizedViewModel(d);
    const entity = d.entity || 'ATA';
    const w = window.open('', '_blank');
    if (!w) return;
    const doc = w.document;

    const baseHref = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
    const base = doc.createElement('base');
    base.href = baseHref;
    doc.head.appendChild(base);

    const title = doc.createElement('title');
    title.textContent = 'Expense Report ' + d.id;
    doc.head.appendChild(title);

    const style = doc.createElement('style');
    style.textContent = `
      @page { size: A4; margin: 15mm 20mm; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1e293b; max-width: 210mm; margin: 0 auto; padding: 0; }
      .header-container { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; border-bottom: 2px solid #1e293b; padding-bottom: 12px; }
      .logo-box { display: flex; align-items: center; gap: 12px; max-height: 55px; }
      .logo-img { ${entity === 'LTA' ? 'height: 42px; margin-bottom: 5px;' : 'height: 55px;'} display: block; }
      .title-box { text-align: right; }
      .doc-title { font-size: 18pt; font-weight: 700; letter-spacing: 4px; text-transform: uppercase; color: #0f172a; margin: 0; }
      
      .two-col { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
      .col-left { flex: 1.2; border: 1.5px solid #1e293b; padding: 12px; border-radius: 12px; background: #fff; }
      .col-left h3 { font-size: 8.5pt; text-transform: uppercase; color: #64748b; margin: 0 0 6px 0; font-weight: 700; letter-spacing: 0.5px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
      .col-left p { margin: 2px 0; font-size: 10pt; }
      
      .col-right { flex: 0.8; display: flex; flex-direction: column; justify-content: center; font-size: 9.5pt; border: 1.5px dashed #cbd5e1; padding: 12px; border-radius: 12px; }
      .meta-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .meta-row:last-child { margin-bottom: 0; }
      .meta-label { color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.5px; }
      .meta-val { font-weight: 700; color: #0f172a; }
      
      table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 10pt; }
      th { background: #f8fafc; border-top: 1.5px solid #1e293b; border-bottom: 1.5px solid #1e293b; padding: 10px 8px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 8.5pt; color: #334155; letter-spacing: 0.5px; }
      td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; color: #0f172a; }
      .num { text-align: right; }
      
      .totals-container { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 16px; gap: 20px; }
      .amount-words-box { flex: 1.2; font-size: 9pt; color: #475569; padding: 10px 0; }
      .amount-words-box strong { color: #0f172a; text-transform: uppercase; font-size: 8pt; display: block; margin-bottom: 4px; letter-spacing: 0.5px; }
      .amount-val-box { flex: 0.8; display: flex; justify-content: flex-end; align-items: center; font-weight: 700; font-size: 11pt; color: #0f172a; }
      .total-label { margin-right: 12px; font-size: 8.5pt; text-transform: uppercase; color: #475569; letter-spacing: 0.5px; }
      .total-amount-box { display: flex; border: 1.5px solid #1e293b; border-radius: 12px; }
      .total-currency { padding: 6px 12px; background: #f1f5f9; border-right: 1.5px solid #1e293b; font-size: 10pt; }
      .total-val { padding: 6px 18px; font-size: 11.5pt; min-width: 120px; text-align: right; font-family: monospace; }
      
      .bottom-layout { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 30px; gap: 24px; }
      .payment-details-box { flex: 1.2; border: 1.5px solid #1e293b; padding: 12px; border-radius: 12px; font-size: 9pt; background: #fff; }
      .payment-details-box h4 { margin: 0 0 8px 0; font-size: 8.5pt; text-transform: uppercase; color: #475569; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; font-weight: 700; letter-spacing: 0.5px; }
      .payment-details-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; }
      .payment-details-grid .lbl { color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 7.5pt; }
      .payment-details-grid .val { color: #0f172a; font-weight: 700; }
      .payment-details-line { border-bottom: 1px solid #94a3b8; width: 120px; height: 14px; display: inline-block; }
      
      .signature-row { display: flex; justify-content: space-between; margin-top: 40px; gap: 30px; }
      .signature-box { flex: 1; text-align: center; }
      .signature-box .line { border-top: 1.5px solid #1e293b; padding-top: 6px; font-size: 9.5pt; font-weight: 700; color: #0f172a; }
      .signature-box .line span { font-size: 8pt; color: #64748b; font-weight: 500; display: block; margin-top: 2px; }
      
      .footer { margin-top: 35px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1.5px solid #e2e8f0; padding-top: 12px; }
      .thank-you { font-weight: 700; font-size: 10pt; color: #334155; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px; }
    `;
    doc.head.appendChild(style);

    const isReleased = d.status === 'Released';
    const pd = d.paymentDetails || {};

    let paymentDetailsHtml = '';
    if (isReleased && pd.method) {
      paymentDetailsHtml = `
        <div class="payment-details-grid">
          <span class="lbl">Date:</span>
          <span class="val">${formatDate(pd.date || d.releasedAt)}</span>
          <span class="lbl">Method:</span>
          <span class="val">${escapeHtml(pd.method)}</span>
          <span class="lbl">Ref/Check No.:</span>
          <span class="val" style="font-family:monospace;">${escapeHtml(pd.reference || '—')}</span>
          <span class="lbl">Bank/Branch:</span>
          <span class="val">${escapeHtml(pd.bank || '—')}</span>
        </div>
      `;
    } else {
      paymentDetailsHtml = `
        <div class="payment-details-grid">
          <span class="lbl">Date:</span>
          <span class="payment-details-line"></span>
          <span class="lbl">Method:</span>
          <span class="payment-details-line"></span>
          <span class="lbl">Check/Ref No.:</span>
          <span class="payment-details-line"></span>
          <span class="lbl">Bank/Branch:</span>
          <span class="payment-details-line"></span>
        </div>
      `;
    }

    const amountInWords = this._numberToWords(d.amount) + ' PESOS ONLY';
    const cleanAmountString = formatPHP(d.amount).replace('₱', '').trim();

    doc.body.innerHTML = `
      <div class="header-container" style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; border-bottom: 2px solid #1e293b; padding-bottom: 12px;">
        <div class="logo-box">
          ${noLogo ? '' : `<img class="logo-img" src="ERP_Assets/${entity === 'LTA' ? 'LTA-LOGO.jpg' : 'ATA-LOGO.jpg'}" alt="${entity} Logo">`}
          <span style="font-size: 14pt; font-weight: 700; color: #0f172a; letter-spacing: 0.5px; white-space: nowrap;">${entity} Accounting Services Firm</span>
        </div>
        <div class="title-box">
          <h1 class="doc-title">Expense Report</h1>
        </div>
      </div>

      <div class="two-col">
        <div class="col-left">
          <h3>Employee / Requester</h3>
          <p><strong>${safe.empName}</strong></p>
          <p style="color: #475569; font-size: 9pt; margin-top: 4px;">${safe.requesterEmail}</p>
          <p style="color: #64748b; font-size: 8.5pt; margin-top: 2px;">Requested By: ${safe.requesterName}</p>
        </div>
        <div class="col-right">
          <div class="meta-row">
            <span class="meta-label">Ref No.:</span>
            <span class="meta-val">${d.id}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Date Submitted:</span>
            <span class="meta-val">${formatDate(d.submittedAt)}</span>
          </div>
          ${safe.wr ? `
          <div class="meta-row" style="margin-top: 6px; border-top: 1px dashed #cbd5e1; padding-top: 6px;">
            <span class="meta-label">Project Code:</span>
            <span class="meta-val" style="font-size: 8.5pt;">${safe.wrTitle}</span>
          </div>
          ` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Description</th>
            <th>Fund Source</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight: 600;">${safe.category}</td>
            <td>${safe.description}</td>
            <td>${this.getFundSource(d)}</td>
            <td class="num" style="font-weight: 700; font-family: monospace;">${formatPHP(d.amount)}</td>
          </tr>
        </tbody>
      </table>

      <div class="totals-container">
        <div class="amount-words-box">
          <strong>Amount in Words</strong>
          ${amountInWords}
        </div>
        <div class="amount-val-box">
          <span class="total-label">Total Amount:</span>
          <div class="total-amount-box">
            <div class="total-currency">PHP</div>
            <div class="total-val">${cleanAmountString}</div>
          </div>
        </div>
      </div>

      <div class="bottom-layout">
        <div class="payment-details-box">
          <h4>Payment Details</h4>
          ${paymentDetailsHtml}
        </div>
      </div>

      <div class="signature-row">
        <div class="signature-box">
          <div style="height: 50px;"></div>
          <div class="line">
            ${safe.empName}
            <span>Prepared By / Date</span>
          </div>
        </div>
        <div class="signature-box">
          <div style="height: 50px;"></div>
          <div class="line">
            ${safe.approverName}
            <span>Approved By / Date</span>
          </div>
        </div>
        <div class="signature-box">
          <div style="height: 50px;"></div>
          <div class="line">
            ${safe.releaserName}
            <span>Released By / Date</span>
          </div>
        </div>
      </div>
    `;

    setTimeout(() => w.print(), 300);
  },

  generateVoucher(d) {
    const noLogo = true;
    const safe = this._getSanitizedViewModel(d);
    const entity = d.entity || 'ATA';
    const w = window.open('', '_blank');
    if (!w) return;
    const doc = w.document;

    const baseHref = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
    const base = doc.createElement('base');
    base.href = baseHref;
    doc.head.appendChild(base);

    const title = doc.createElement('title');
    title.textContent = 'Payment Voucher ' + d.id;
    doc.head.appendChild(title);

    const style = doc.createElement('style');
    style.textContent = `
      @page { size: A4; margin: 15mm 20mm; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1e293b; max-width: 210mm; margin: 0 auto; padding: 0; }
      .header-container { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; border-bottom: 2px solid #1e293b; padding-bottom: 12px; }
      .logo-box { display: flex; align-items: center; gap: 12px; max-height: 55px; }
      .logo-img { ${entity === 'LTA' ? 'height: 42px; margin-bottom: 5px;' : 'height: 55px;'} display: block; }
      .title-box { text-align: right; }
      .doc-title { font-size: 18pt; font-weight: 700; letter-spacing: 4px; text-transform: uppercase; color: #0f172a; margin: 0; }
      
      .page-break { page-break-before: always; }
      
      .two-col { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
      .col-left { flex: 1.2; border: 1.5px solid #1e293b; padding: 12px; border-radius: 12px; background: #fff; }
      .col-left h3 { font-size: 8.5pt; text-transform: uppercase; color: #64748b; margin: 0 0 6px 0; font-weight: 700; letter-spacing: 0.5px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
      .col-left p { margin: 2px 0; font-size: 10pt; }
      
      .col-right { flex: 0.8; display: flex; flex-direction: column; justify-content: center; font-size: 9.5pt; border: 1.5px dashed #cbd5e1; padding: 12px; border-radius: 12px; }
      .meta-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .meta-row:last-child { margin-bottom: 0; }
      .meta-label { color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.5px; }
      .meta-val { font-weight: 700; color: #0f172a; }
      
      .section { margin-bottom: 20px; }
      .section h3 { font-size: 9pt; text-transform: uppercase; color: #475569; margin: 0 0 8px; letter-spacing: 0.5px; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 4px; font-weight: 700; }
      .section p { margin: 4px 0; font-size: 9.5pt; }
      
      table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; }
      th { background: #f8fafc; border-top: 1.5px solid #1e293b; border-bottom: 1.5px solid #1e293b; padding: 8px 6px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 8pt; color: #334155; letter-spacing: 0.5px; }
      td { padding: 8px 6px; border-bottom: 1px solid #e2e8f0; color: #0f172a; }
      .num { text-align: right; }
      
      .grid-2 { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 20px; }
      .box { border: 1.5px solid #1e293b; padding: 10px; border-radius: 12px; background: #fff; }
      .amount-words { font-size: 8.5pt; color: #475569; line-height: 1.4; margin-top: 4px; text-transform: uppercase; }
      
      .payment-status-box { border: 1.5px solid #cbd5e1; border-radius: 12px; background: #f8fafc; padding: 10px; margin-top: 8px; color: #1e293b; font-size: 9pt; }
      
      .approval-row { display: flex; justify-content: space-between; margin-top: 40px; gap: 20px; }
      .approval-box { flex: 1; text-align: center; }
      .approval-box .line { border-top: 1.5px solid #1e293b; padding-top: 6px; font-size: 9pt; font-weight: 700; color: #0f172a; }
      .approval-box .line span { font-size: 8pt; color: #64748b; font-weight: 500; display: block; margin-top: 2px; }
      
      .footer { margin-top: 30px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1.5px solid #e2e8f0; padding-top: 10px; }
      .thank-you { font-weight: 700; font-size: 10pt; color: #334155; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px; }
    `;
    doc.head.appendChild(style);

    const amountWords = this._numberToWords(d.amount) + ' PESOS ONLY';
    const isReleased = d.status === 'Released';
    const pd = d.paymentDetails || {};
    const cleanAmountString = formatPHP(d.amount).replace('₱', '').trim();

    let paymentDetailsHtml = '';
    if (isReleased && pd.method) {
      const methodCfg = PaymentIcons;
      const def = methodCfg['Other Digital'];
      const cfg = methodCfg[pd.method] || def;

      let detailRows = '';
      const addRow = (label, value) => {
        if (!value) return '';
        return `<div style="display:flex; justify-content:space-between; align-items:baseline; font-size:8.5pt; padding:3px 0; border-bottom: 1px dashed #f1f5f9;">
          <span style="color:#64748b; font-weight:600; text-transform:uppercase; font-size:7.5pt;">${label}</span>
          <span style="color:#0f172a; font-weight:700;">${escapeHtml(value)}</span>
        </div>`;
      };

      if (pd.reference) detailRows += addRow('Reference / Check No.', pd.reference);
      if (pd.bank) detailRows += addRow('Bank', pd.bank);
      detailRows += addRow('Released By', safe.releaser ? safe.releaser.name : (safe.handler ? safe.handler.name : '—'));
      detailRows += addRow('Date of Release', formatDate(pd.date || d.releasedAt));

      paymentDetailsHtml = `
        <div class="section">
          <h3>Payment Record</h3>
          <div class="grid-2">
            <div class="box" style="display: flex; flex-direction: column; justify-content: space-between;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <div>
                  <div style="font-weight:700; font-size:1.15rem; color:#0f172a; line-height:1.2; font-family: monospace;">${formatPHP(d.amount)}</div>
                  <div style="font-size:7.5pt; color:#64748b; margin-top:2px;">Released on ${formatDate(pd.date || d.releasedAt)}</div>
                </div>
                <span style="display:inline-flex; align-items:center; gap:6px; padding:3px 8px; border-radius: 12px; font-size:7.5pt; font-weight:700; color:${cfg.color}; background:${cfg.bg}; letter-spacing:0.3px; border: 1px solid ${cfg.color}33;">
                  ${cfg.label}
                </span>
              </div>
              <div style="height:1px; background:#e2e8f0; margin:4px 0 8px;"></div>
              <div style="display:flex; flex-direction:column; gap:4px;">${detailRows}</div>
            </div>
            <div class="payment-status-box" style="display: flex; flex-direction: column; justify-content: center; height: 100%; box-sizing: border-box;">
              <p style="margin: 0; font-size:9.5pt; line-height: 1.5; color: #1e293b;">Payment has been authorized by <strong>${safe.approverName}</strong> and released by <strong>${safe.releaserName}</strong>.</p>
            </div>
          </div>
        </div>`;
    } else {
      paymentDetailsHtml = `
        <div class="section">
          <h3>Payment Details</h3>
          <div class="grid-2">
            <div class="box" style="display: flex; flex-direction: column; justify-content: space-between;">
              <p style="margin: 0 0 8px 0; font-size: 9.5pt;"><strong>Amount in Figures:</strong> <span style="font-family: monospace; font-weight: 700;">${formatPHP(d.amount)}</span></p>
              <p class="amount-words" style="margin: 0;"><strong>Amount in Words:</strong> <span style="font-weight: 600;">${amountWords}</span></p>
            </div>
            <div class="box" style="display: flex; flex-direction: column; gap: 4px; font-size: 8.5pt;">
              <div style="display: flex; justify-content: space-between;"><span style="color:#64748b; font-weight:600; text-transform:uppercase; font-size:7.5pt;">Payment Mode:</span> <span style="border-bottom: 1px solid #94a3b8; width: 100px; height: 12px; display: inline-block;"></span></div>
              <div style="display: flex; justify-content: space-between;"><span style="color:#64748b; font-weight:600; text-transform:uppercase; font-size:7.5pt;">Check / Ref No.:</span> <span style="border-bottom: 1px solid #94a3b8; width: 100px; height: 12px; display: inline-block;"></span></div>
              <div style="display: flex; justify-content: space-between;"><span style="color:#64748b; font-weight:600; text-transform:uppercase; font-size:7.5pt;">Bank / Platform:</span> <span style="border-bottom: 1px solid #94a3b8; width: 100px; height: 12px; display: inline-block;"></span></div>
              <div style="display: flex; justify-content: space-between;"><span style="color:#64748b; font-weight:600; text-transform:uppercase; font-size:7.5pt;">Date:</span> <span style="border-bottom: 1px solid #94a3b8; width: 100px; height: 12px; display: inline-block;"></span></div>
            </div>
          </div>
        </div>`;
    }

    const thankYouText = 'THANK YOU !!!';
    const entityFooterContact = entity === 'LTA' 
      ? 'Should you have any enquiries concerning this statement, please contact us on 742-8582/404-4928.<br>' 
      : '';

    doc.body.innerHTML = `
      <div class="header-container" style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; border-bottom: 2px solid #1e293b; padding-bottom: 12px;">
        <div class="logo-box">
          ${noLogo ? '' : `<img class="logo-img" src="ERP_Assets/${entity === 'LTA' ? 'LTA-LOGO.jpg' : 'ATA-LOGO.jpg'}" alt="${entity} Logo">`}
          <span style="font-size: 14pt; font-weight: 700; color: #0f172a; letter-spacing: 0.5px; white-space: nowrap;">${entity} Accounting Services Firm</span>
        </div>
        <div class="title-box">
          <h1 class="doc-title">Payment Voucher</h1>
        </div>
      </div>

      <div class="two-col">
        <div class="col-left">
          <h3>Payee Information</h3>
          <p><strong>${safe.empName}</strong></p>
          <p style="color: #475569; font-size: 9pt; margin-top: 4px;">${safe.requesterEmail}</p>
          <p style="color: #64748b; font-size: 8.5pt; margin-top: 2px;">Fund Source: ${this.getFundSource(d)}</p>
        </div>
        <div class="col-right">
          <div class="meta-row">
            <span class="meta-label">Voucher No.:</span>
            <span class="meta-val">PV-${d.id}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Date:</span>
            <span class="meta-val">${formatDate(new Date().toISOString().slice(0, 10))}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Expense Ref:</span>
            <span class="meta-val">${d.id}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">Category:</span>
            <span class="meta-val">${safe.category}</span>
          </div>
        </div>
      </div>

      ${paymentDetailsHtml}

      <div class="section">
        <h3>Account Distribution (PFRS Chart of Accounts)</h3>
        <table>
          <thead>
            <tr>
              <th>Account Code</th>
              <th>Account Title</th>
              <th class="num">Debit</th>
              <th class="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="font-family: monospace;">61010</td>
              <td>${safe.category} Expense</td>
              <td class="num" style="font-family: monospace;">${formatPHP(d.amount)}</td>
              <td class="num">—</td>
            </tr>
            <tr>
              <td style="font-family: monospace;">11010</td>
              <td>Cash in Bank / Petty Cash</td>
              <td class="num">—</td>
              <td class="num" style="font-family: monospace;">${formatPHP(d.amount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section page-break">
        <h3>Supporting Documents</h3>
        <p style="font-size: 9pt; color: #334155; margin: 6px 0;">☐ Expense Report Ref. ${d.id} dated ${formatDate(d.submittedAt)}</p>
        <p style="font-size: 9pt; color: #334155; margin: 6px 0;">☐ Receipt / Proof of Payment: <span style="font-family: monospace; font-weight: 600;">${safe.receiptFilename}</span></p>
        <p style="font-size: 9pt; color: #334155; margin: 6px 0;">☐ Work Request: <span style="font-weight: 600;">${safe.wrTitle}</span></p>
        <p style="font-size: 9pt; color: #334155; margin: 6px 0;">☐ Release Document: <span style="font-family: monospace; font-weight: 600;">${safe.releaseFilename}</span></p>
      </div>

      <div class="approval-row">
        <div class="approval-box">
          <div style="height: 45px;"></div>
          <div class="line">
            ${safe.empName}
            <span>Prepared By / Date</span>
          </div>
        </div>
        <div class="approval-box">
          <div style="height: 45px;"></div>
          <div class="line">
            HENRY WONG
            <span>Reviewed By / Date</span>
          </div>
        </div>
        <div class="approval-box">
          <div style="height: 45px;"></div>
          <div class="line">
            ${safe.approverName}
            <span>Approved By / Date</span>
          </div>
        </div>
        <div class="approval-box">
          <div style="height: 45px;"></div>
          <div class="line">
            ${safe.releaserName}
            <span>Released By / Date</span>
          </div>
        </div>
        <div class="approval-box">
          <div style="height: 45px;"></div>
          <div class="line">
            ________________________
            <span>Received By / Date</span>
          </div>
        </div>
      </div>

      <div class="footer">
        <div class="thank-you">${thankYouText}</div>
        ${noLogo ? '' : entityFooterContact}
        This Payment Voucher is prepared in accordance with PFRS, RR No. 9-2009, and RMO No. 29-2002.<br>
        Retain for BIR audit trail. ${noLogo ? '' : `Original copy retained by ${entity} Accounting Services Firm.<br>`}
        <span style="font-weight: 600; text-transform: uppercase; font-size: 7.5pt; letter-spacing: 0.5px; color: #475569; display: block; margin-top: 4px;">This document is not valid for claim of input tax.</span>
      </div>
    `;

    setTimeout(() => w.print(), 300);
  },

  // ============================================================
  // Templates View
  // ============================================================
  async renderTemplates() {
    const entity = Auth.activeEntity;
    await this.ensureTemplates();
    const templates = this._templates;

    const wrapper = el('div', { class: 'page-content-section' });

    const backlogItems = templates.map(t => {
      return {
        id: t.id,
        name: t.name,
        iconHtml: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-primary);"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
        tags: [
          { text: t.category || 'Other', type: 'category' },
          { text: t.fundSource || 'Firm Fund', type: 'fund', value: t.fundSource },
          { text: t.schedule || '—', type: 'schedule', value: t.schedule, style: 'text-transform: capitalize;' },
          { text: formatPHP(t.amount || 0), type: 'amount' }
        ]
      };
    });

    const backlog = JiraBacklogList.render({
      title: 'Disbursement Templates',
      subtitle: 'recurring expense presets, fund source categories, and schedule billing configurations',
      items: backlogItems,
      emptyText: 'No templates found',
      rowIdPrefix: 'DT',
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
                  await window.apiClient.disbursements.deleteTemplate(t.id);
                  this._templates = this._templates.filter(temp => temp.id !== t.id);
                  App.handleRoute();
                } catch (e) {
                  console.error('Failed to delete template', t.id, e);
                  Workflow.showMessage('Delete Failed', e.message || 'Unable to delete template.', 'error');
                }
              }, 'danger');
            }
          }
        ];
      },
      bulkActions: (selectedIds) => [
        {
          text: selectedIds.length === 1 ? '⚡ Generate Disbursement' : '⚡ Bulk Generate Disbursements',
          className: 'btn btn-primary btn-sm',
          onClick: (ids) => {
            const title = ids.length === 1 ? 'Generate Disbursement' : 'Bulk Generate Disbursements';
            const message = ids.length === 1
              ? 'Are you sure you want to generate a disbursement for this selected template?'
              : `Are you sure you want to generate disbursements for all ${ids.length} selected templates?`;
            Workflow.showConfirm(title, message, async () => {
              const templatesToGenerate = ids.map(id => templates.find(temp => temp.id === id)).filter(Boolean);
              if (templatesToGenerate.length === 0) return;

              this.view = 'list';
              const optimistic = [];
              templatesToGenerate.forEach(t => {
                const payload = {
                  category: t.category,
                  description: t.description || t.name,
                  amount: t.amount,
                  fundSource: t.fundSource,
                  linkedInvoiceId: t.linkedInvoiceId || null,
                  linkedWorkRequestId: t.linkedWorkRequestId || null,
                  clientId: null,
                  employeeId: Auth.user.id,
                  notes: null
                };
                const record = this._buildOptimisticDisbursement({ ...payload, fromTemplate: true });
                this._insertOptimisticDisbursement(record);
                optimistic.push({ localId: record.id, payload, template: t });
              });
              const completedGen = this._activeSkipGeneration;
              let successCount = 0;
              const failures = [];
              for (const { localId, payload, template } of optimistic) {
                try {
                  const res = await window.apiClient.disbursements.create(payload);
                  const serverRecord = this.normalizeDisbursement(res.data);
                  this._replaceOptimisticCreate(localId, serverRecord);
                  successCount++;
                } catch (e) {
                  this._removeFromItems(localId);
                  this._refreshCounts();
                  this._invalidateDashboardCache();
                  failures.push(template.name);
                  console.error('Failed to generate disbursement from template', template.id, e);
                }
              }

              this._clearSkipGenerationIfCurrent(completedGen);
              App.handleRoute();

              if (failures.length === 0) {
                Workflow.showMessage('Success', `Generated ${successCount} disbursement${successCount === 1 ? '' : 's'} successfully.`, 'success');
              } else {
                Workflow.showMessage('Partial Success', `Generated ${successCount} of ${optimistic.length}. Failed: ${failures.join(', ')}`, 'warning');
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
                await Promise.all(ids.map(id => window.apiClient.disbursements.deleteTemplate(id)));
                this._templates = this._templates.filter(temp => !ids.includes(temp.id));
                App.handleRoute();
              } catch (e) {
                console.error('Failed to bulk delete templates', e);
                Workflow.showMessage('Delete Failed', e.message || 'Unable to delete templates.', 'error');
              }
            }, 'danger');
          }
        }
      ]
    });

    this.backgroundRefreshTemplates().catch(err => {
      if (!isAbortError(err)) console.warn('Disbursement template background refresh failed', err);
    });

    this.backgroundRefreshTemplates().catch(err => {
      if (!isAbortError(err)) console.warn('Disbursement template background refresh failed', err);
    });

    wrapper.appendChild(backlog);
    return wrapper;
  },

  async renderTemplateForm(opts = {}) {
    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure(),
      window.apiClient.workRequestCache.ensure()
    ]);
    const { hideHeader = false, template = null } = opts;
    const entity = Auth.activeEntity;
    const container = el('div', { class: 'page' });

    const form = el('form', { id: 'disb-tpl-form', class: 'form-stacked notion-form' });

    if (!hideHeader) {
      const headerBar = el('div', { class: 'form-header-bar' });
      const topActions = el('div', { class: 'form-actions-top' });
      topActions.appendChild(el('button', { type: 'submit', form: 'disb-tpl-form', class: 'btn btn-primary', text: 'Save Template' }));
      if (template) {
        const delBtn = el('button', { type: 'button', class: 'btn btn-danger', text: 'Delete', style: 'margin-left: 8px;' });
        delBtn.addEventListener('click', () => {
          Workflow.showConfirm('Delete Template', `Are you sure you want to delete "${template.name}"?`, async () => {
            try {
              await window.apiClient.disbursements.deleteTemplate(template.id);
              this._templates = this._templates.filter(t => t.id !== template.id);
              this.view = 'templates';
              this.templateEditingId = null;
              closeFormPanelAndRoute('#disbursement');
            } catch (e) {
              console.error('Failed to delete template', template.id, e);
              Workflow.showMessage('Delete Failed', e.message || 'Unable to delete template.', 'error');
            }
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
      placeholder: 'New Disbursement Template', required: true, value: template?.name || ''
    });
    titleSection.appendChild(nameInput);
    form.appendChild(titleSection);

    const catGroup = el('div', { class: 'form-group' });
    catGroup.appendChild(el('label', { text: 'Category *' }));
    const catSel = el('select', { name: 'category', required: true, class: 'form-select' });
    this.STANDARD_CATEGORIES.forEach(c => {
      catSel.appendChild(el('option', { value: c, text: c }));
    });
    if (template) catSel.value = template.category || '';
    catGroup.appendChild(catSel);
    form.appendChild(catGroup);

    const amtGroup = el('div', { class: 'form-group' });
    amtGroup.appendChild(el('label', { text: 'Amount (₱) *' }));
    const amtInput = el('input', { type: 'number', name: 'amount', min: 0, step: 0.01, required: true, value: template?.amount || '' });
    amtGroup.appendChild(amtInput);
    form.appendChild(amtGroup);

    const fundGroup = el('div', { class: 'form-group' });
    fundGroup.appendChild(el('label', { text: 'Fund Source *' }));
    const fundWrap = el('div', { class: 'radio-group' });
    ['Firm Fund', 'Client Fund'].forEach(f => {
      const label = el('label', { class: 'radio-label' });
      const radio = el('input', { type: 'radio', name: 'fundSource', value: f, required: true });
      if (!template && f === 'Firm Fund') radio.checked = true;
      if (template && f === template.fundSource) radio.checked = true;
      label.appendChild(radio);
      label.appendChild(document.createTextNode(' ' + f));
      fundWrap.appendChild(label);
    });
    fundGroup.appendChild(fundWrap);
    form.appendChild(fundGroup);

    const scheduleGroup = el('div', { class: 'form-group' });
    scheduleGroup.appendChild(el('label', { text: 'Schedule' }));
    const schedInput = el('input', { type: 'text', name: 'schedule', placeholder: 'e.g. Monthly, Weekly, Quarterly', value: template?.schedule || '' });
    scheduleGroup.appendChild(schedInput);
    form.appendChild(scheduleGroup);

    const descGroup = el('div', { class: 'form-group' });
    descGroup.appendChild(el('label', { text: 'Description' }));
    const descInput = el('textarea', { name: 'description', rows: 3, text: template?.description || '' });
    descGroup.appendChild(descInput);
    form.appendChild(descGroup);

    const wrGroup = el('div', { class: 'form-group' });
    wrGroup.appendChild(el('label', { text: 'Linked Work Request (optional)' }));
    const wrSel = el('select', { name: 'linkedWorkRequestId', class: 'form-select' });
    wrSel.appendChild(el('option', { value: '', text: '— None —' }));
    (window.apiClient.workRequestCache._wrs || []).filter(wr => matchesEntity(wr.entity, entity)).forEach(wr => {
      const client = window.apiClient.clientCache.getById(wr.clientId);
      wrSel.appendChild(el('option', { value: wr.id, text: wr.title + ' — ' + (client?.name || '—') }));
    });
    if (template) wrSel.value = template.linkedWorkRequestId || '';
    wrGroup.appendChild(wrSel);
    form.appendChild(wrGroup);

    const invGroup = el('div', { class: 'form-group' });
    invGroup.appendChild(el('label', { text: 'Linked Invoice (optional)' }));
    const invSel = el('select', { name: 'linkedInvoiceId', class: 'form-select' });
    invSel.appendChild(el('option', { value: '', text: '— None —' }));
    invGroup.appendChild(invSel);
    form.appendChild(invGroup);

    window.apiClient.invoices.list({ status: 'Draft,Sent,Partially Paid,Paid', limit: 200 }).then(res => {
      const invoices = (res.data || []).filter(inv => matchesEntity(inv.entity, entity) && inv.status !== 'Cancelled');
      invoices.forEach(inv => {
        const client = window.apiClient.clientCache.getById(inv.clientId);
        const opt = el('option', { value: inv.id, text: inv.invoiceNumber + ' — ' + (client?.name || '—') });
        if (template && template.linkedInvoiceId === inv.id) opt.selected = true;
        invSel.appendChild(opt);
      });
    }).catch(e => console.error('Failed to load invoices for template form', e));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitTemplateForm(form, template).catch(err => console.error('submitTemplateForm error', err));
    });

    container.appendChild(form);
    return container;
  },

  async submitTemplateForm(form, template) {
    if (!validateRequiredFields(form)) return;
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      name: data.name.trim(),
      category: data.category,
      amount: parseFloat(data.amount) || 0,
      fundSource: data.fundSource,
      schedule: data.schedule || null,
      description: data.description || null,
      linkedWorkRequestId: data.linkedWorkRequestId || null,
      linkedInvoiceId: data.linkedInvoiceId || null
    };

    let optimisticTemplate = null;
    let templateGen = 0;
    try {
      if (template) {
        const res = await window.apiClient.disbursements.updateTemplate(template.id, payload);
        const updated = this.normalizeTemplate(res.data);
        const idx = this._templates.findIndex(t => t.id === updated.id);
        if (idx >= 0) this._templates[idx] = updated;
        else this._templates.push(updated);
      } else {
        const recordEntity = this._getOptimisticEntity();
        optimisticTemplate = this.normalizeTemplate({
          ...payload,
          id: this._tempId('tpl'),
          entity: recordEntity,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        this._templates.push(optimisticTemplate);
        this._templatesEntity = Auth.activeEntity;
        templateGen = this._setActiveSkipGeneration();
        if (this.view !== 'form' && this.view !== 'templateForm' && this.view !== 'detail') {
          App.handleRoute();
        }
        const res = await window.apiClient.disbursements.createTemplate(payload);
        const created = this.normalizeTemplate(res.data);
        if (!created.entity) created.entity = recordEntity;
        const idx = this._templates.findIndex(t => t.id === optimisticTemplate.id);
        if (idx >= 0) this._templates[idx] = created;
        else this._templates.push(created);
        this._clearSkipGenerationIfCurrent(templateGen);
        if (this.view !== 'form' && this.view !== 'templateForm' && this.view !== 'detail') {
          App.handleRoute();
        }
      }
    } catch (e) {
      console.error('Failed to save disbursement template', e);
      if (!template && optimisticTemplate) {
        this._templates = this._templates.filter(t => t.id !== optimisticTemplate.id);
        this._clearSkipGenerationIfCurrent(templateGen);
        if (this.view !== 'form' && this.view !== 'templateForm' && this.view !== 'detail') {
          App.handleRoute();
        }
      }
      Workflow.showMessage('Save Failed', e.message || 'Unable to save template.', 'error');
      return;
    }

    this.view = 'templates';
    this.templateEditingId = null;
    closeFormPanelAndRoute('#disbursement');
  },

  async showTemplateForm(existing = null, mode = null) {
    this.templateEditingId = existing ? existing.id : null;
    const template = this.templateEditingId ? (await this.getTemplateById(this.templateEditingId) || existing) : null;
    const fullPageRoute = this.templateEditingId ? `#disbursement/templateForm/${this.templateEditingId}` : '#disbursement/templateForm/new';
    openFormPanel({
      icon: '📋',
      title: ' ',
      formContent: await this.renderTemplateForm({ template }),
      formId: 'disb-tpl-form',
      mode,
      viewContext: 'disbursement-template-form',
      fullPageRoute,
      newTabRoute: fullPageRoute,
      actions: [
        { text: 'Save Template', class: 'btn btn-primary', type: 'submit', form: 'disb-tpl-form' },
        { text: 'Cancel', class: 'btn btn-secondary', onClick: () => closeFormPanelAndRoute('#disbursement') }
      ]
    });
  },

  async generateFromTemplate(template) {
    const payload = {
      category: template.category,
      description: template.description || template.name,
      amount: template.amount,
      fundSource: template.fundSource,
      linkedInvoiceId: template.linkedInvoiceId || null,
      linkedWorkRequestId: template.linkedWorkRequestId || null,
      clientId: null,
      employeeId: Auth.user.id,
      notes: null
    };

    this.view = 'list';
    const optimisticRecord = this._buildOptimisticDisbursement({ ...payload, fromTemplate: true });
    this._addOptimisticDisbursement(optimisticRecord);
    const completedGen = this._activeSkipGeneration;

    try {
      const res = await window.apiClient.disbursements.create(payload);
      const serverRecord = this.normalizeDisbursement(res.data);
      this._replaceOptimisticCreate(optimisticRecord.id, serverRecord);
      this._clearSkipGenerationIfCurrent(completedGen);
      App.handleRoute();
      Workflow.showMessage('Template Success', 'Disbursement generated from template: ' + template.name, 'success');
    } catch (e) {
      this._rollbackOptimisticCreate(optimisticRecord.id, e, 'Generation Failed');
      return;
    }
  },

  async archiveDisbursement(id) {
    const d = await this.loadDisbursement(id);
    if (!d || d.archived) return;
    try {
      await this._optimisticUpdate(id, { archived: true }, () => window.apiClient.disbursements.archive(id), 'Archive Failed');
      Workflow.showMessage('Archived', 'Disbursement has been archived.', 'success');
    } catch (e) {
      // Error surfaced by _optimisticUpdate.
    }
  },

  async trashDisbursement(id) {
    const d = await this.loadDisbursement(id);
    if (!d || d.archived) return;
    Workflow.showConfirm('Trash Expense', `Are you sure you want to move disbursement "${d.description || d.category || '(untitled)'}" to trash? It will be moved to Archive.`, async () => {
      if (this.view === 'detail' && this.detailId === id) {
        location.hash = '#disbursement';
      }
      try {
        await this._optimisticUpdate(id, { archived: true }, () => window.apiClient.disbursements.archive(id), 'Trash Failed');
        Workflow.showMessage('Trashed', 'Disbursement has been moved to Archive.', 'success');
      } catch (e) {
        // Error surfaced by _optimisticUpdate.
      }
    }, 'warning');
  },

  async bulkArchiveDisbursements(ids) {
    await this.loadDisbursements();
    const eligible = (ids || [])
      .map(id => (this._items || []).find(d => d.id === id))
      .filter(d => d && !d.archived);

    if (eligible.length === 0) {
      Workflow.showMessage('No eligible records', 'No active disbursements to archive.', 'info');
      return;
    }

    Workflow.showConfirm('Bulk Archive',
      `Are you sure you want to archive ${eligible.length} disbursement(s)?`,
      async () => {
        let count = 0;
        const failedIds = [];
        for (const d of eligible) {
          try {
            await this._optimisticUpdate(d.id, { archived: true, updatedAt: new Date().toISOString() }, () =>
              window.apiClient.disbursements.archive(d.id), 'Archive Failed');
            count++;
          } catch (e) {
            failedIds.push(d.id);
          }
        }
        if (failedIds.length > 0 && count > 0) {
          Workflow.showMessage('Partial Success', `${count} disbursement(s) archived, ${failedIds.length} failed.`, 'warning');
        } else if (count > 0) {
          Workflow.showMessage('Archived', `${count} disbursement(s) archived.`, 'success');
        } else if (failedIds.length > 0) {
          Workflow.showMessage('Archive Failed', `Unable to archive ${failedIds.length} disbursement(s).`, 'error');
        }
      },
      'warning'
    );
  },

  async unarchiveDisbursement(id) {
    const d = await this.loadDisbursement(id);
    if (!d) return;
    const isCancelled = d.status === 'Cancelled';
    const targetStatus = isCancelled ? 'Draft' : d.status;
    const title = isCancelled ? 'Restore Expense' : 'Unarchive Expense';
    const prompt = isCancelled
      ? `Are you sure you want to restore disbursement "${d.description || d.category || '(untitled)'}" to Draft?`
      : `Are you sure you want to unarchive disbursement "${d.description || d.category || '(untitled)'}"?`;

    Workflow.showConfirm(title, prompt, async () => {
      try {
        await this._optimisticUpdate(id, { archived: false, status: targetStatus }, () => window.apiClient.disbursements.unarchive(id), 'Unarchive Failed');
        Workflow.showMessage('Restored', 'Disbursement has been restored to the active list.', 'success');
      } catch (e) {
        // Error surfaced by _optimisticUpdate.
      }
    }, 'success');
  },

  async permanentDeleteDisbursement(id) {
    const d = await this.loadDisbursement(id);
    if (!d) return;
    if (Auth.user?.role !== 'Admin' && !Auth.can('disbursement:delete') && !Auth.isManagerial()) {
      Workflow.showMessage('Permission Denied', 'Only authorized users can delete disbursements.', 'danger');
      return;
    }
    Workflow.showConfirm('Delete Disbursement',
      `Are you sure you want to delete disbursement "${d.description || d.category}"?`,
      async () => {
        try {
          await this._optimisticDelete(id, () => window.apiClient.disbursements.remove(id), 'Delete Failed');
          Workflow.showMessage('Deleted', 'Disbursement has been permanently deleted.', 'success');
        } catch (e) {
          // Error surfaced by _optimisticDelete.
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

    let archivedDisbursements = [];
    try {
      archivedDisbursements = await this.fetchDisbursements({
        archived: true,
        page: this._archivePage,
        limit: this._archiveLimit,
      });
      this._lastArchiveMeta = this._lastDisbursementMeta || {};
    } catch (e) {
      this._lastArchiveMeta = {};
    }

    const isFirstPageOrSkip = (this._archivePage || 1) === 1 || (this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration);
    const localArchived = isFirstPageOrSkip ? (this._items || []).filter(d => this._entityMatches(d, entity) && d.archived === true) : [];
    const dMap = new Map();
    archivedDisbursements.forEach(d => dMap.set(d.id, d));
    localArchived.forEach(d => {
      if (!dMap.has(d.id)) dMap.set(d.id, d);
    });
    archivedDisbursements = Array.from(dMap.values()).filter(d => {
      const cached = this._getCachedItem(d.id);
      return !cached || cached.archived !== false;
    });

    const funded = archivedDisbursements.filter(d => d.archived === true);
    const cancelled = archivedDisbursements.filter(d => d.status === 'Cancelled' && !d.archived);

    let rejectedDisbursementChanges = [];
    let rejectedDisbursementRequests = [];
    try {
      const pendingRes = await window.apiClient.admin.listPendingApprovals({ status: 'rejected', tableName: 'disbursements' });
      rejectedDisbursementChanges = (pendingRes.data || []).filter(pc => {
        const data = pc.proposedData || {};
        if (!this._entityMatches(data, entity)) return false;
        if (!isManagerial && pc.submittedBy !== Auth.user?.id) return false;
        return true;
      });
    } catch (e) {
      console.error('Failed to load rejected disbursement changes', e);
    }
    try {
      const opReqRes = await window.apiClient.operationsRequests.list({ status: 'rejected', type: 'disbursement' });
      rejectedDisbursementRequests = (opReqRes.data || []).filter(r => {
        if (!this._entityMatches(r, entity)) return false;
        if (!isManagerial && r.requestedBy !== Auth.user?.id) return false;
        return true;
      });
    } catch (e) {
      console.error('Failed to load rejected disbursement requests', e);
    }

    const buildItem = (d, category) => {
      const emp = window.apiClient.userCache.getById(this.getEmployeeId(d));
      return {
        id: d.id,
        category,
        title: d.description || d.category || '(untitled)',
        meta: [
          { icon: ArchivePage.icons.client, text: emp?.name || '—' },
          { icon: ArchivePage.icons.amount, text: formatPHP(d.amount) },
          { icon: ArchivePage.icons.date, text: formatDate(d.updatedAt) }
        ],
        actions: [
          {
            label: 'View',
            icon: ArchivePage.icons.view,
            onClick: () => { location.hash = '#disbursement/detail/' + d.id; }
          },
          ...(category === 'accomplished' ? [{
            label: 'Unarchive',
            icon: ArchivePage.icons.unarchive,
            className: 'primary',
            onClick: () => self.unarchiveDisbursement(d.id)
          }] : []),
          ...(category === 'cancelled' ? [{
            label: 'Restore to Draft',
            icon: ArchivePage.icons.restore,
            className: 'primary',
            onClick: () => self.unarchiveDisbursement(d.id)
          }] : []),
          ...(isManagerial || Auth.can('disbursement:delete') ? [{
            label: 'Delete Permanently',
            icon: ArchivePage.icons.delete,
            className: 'danger',
            onClick: () => self.permanentDeleteDisbursement(d.id)
          }] : [])
        ]
      };
    };

    const buildRejectedItem = record => {
      const isOpReq = record.hasOwnProperty('requestedBy');
      const data = isOpReq ? record : (record.proposedData || {});
      const title = isOpReq
        ? `Disbursement Request ${record.workRequestId ? 'for WR' : ''}`
        : `Disbursement Change: ${data.description || data.category || '(untitled)'}`;
      const reason = data.rejectionReason || record.rejectionReason || 'Rejected';
      return {
        id: record.id,
        category: 'rejected',
        title,
        meta: [
          { icon: ArchivePage.icons.client, text: (window.apiClient.userCache.getById(isOpReq ? record.requestedBy : data.requestedBy)?.name) || '—' },
          { icon: ArchivePage.icons.date, text: formatDate(record.reviewedAt || record.updatedAt || record.requestedAt) },
          { icon: ArchivePage.icons.status, text: `Reason: ${reason}` }
        ],
        actions: [
          ...(data.id || record.workRequestId ? [{
            label: 'View Related',
            icon: ArchivePage.icons.view,
            onClick: () => {
              if (data.id) location.hash = '#disbursement/detail/' + data.id;
              else if (record.workRequestId) location.hash = '#operations/detail/' + record.workRequestId;
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
      module: 'disbursement',
      categoryLabels: { accomplished: 'Funded', cancelled: 'Cancelled', rejected: 'Rejected' },
      categories: {
        accomplished: funded.map(d => buildItem(d, 'accomplished')),
        cancelled: cancelled.map(d => buildItem(d, 'cancelled')),
        rejected: [
          ...rejectedDisbursementChanges.map(buildRejectedItem),
          ...rejectedDisbursementRequests.map(buildRejectedItem)
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
  // Reimbursement Summary Report
  // ============================================================
  async renderReport() {
    const entity = Auth.activeEntity;
    await this.loadDisbursements();
    const items = (this._items || []).filter(d => {
      const dEnt = (d.entity || '').toUpperCase();
      if (entity === 'ALL') {
        return Auth.user.entities.map(ae => ae.toUpperCase()).includes(dEnt);
      }
      return dEnt === entity.toUpperCase();
    }).filter(d => d.status === 'Released');

    const container = el('div');

    container.appendChild(el('h2', { text: 'Reimbursement Summary', style: 'margin-bottom: var(--spacing-lg);' }));

    const grid = el('div', { class: 'bento-grid' });

    // By Employee
    const byEmployee = {};
    items.forEach(d => {
      const empName = window.apiClient.userCache.getById(this.getEmployeeId(d))?.name || 'Unknown';
      if (!byEmployee[empName]) byEmployee[empName] = { count: 0, total: 0 };
      byEmployee[empName].count++;
      byEmployee[empName].total += d.amount;
    });

    const empCard = el('div', { class: 'bento-item bento-half report-card' });
    empCard.appendChild(el('h3', { text: 'By Employee', style: 'margin-top:0;' }));
    const empTable = el('table', { class: 'report-table' });
    empTable.appendChild(el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Employee' }),
        el('th', { text: 'Count', class: 'text-center' }),
        el('th', { text: 'Total', class: 'text-center' })
      ])
    ]));
    const empBody = el('tbody');
    Object.entries(byEmployee).forEach(([name, data]) => {
      empBody.appendChild(el('tr', {}, [
        el('td', { text: name }),
        el('td', { text: String(data.count), class: 'text-center' }),
        el('td', { text: formatPHP(data.total), class: 'text-center' })
      ]));
    });
    empTable.appendChild(empBody);
    empCard.appendChild(empTable);
    grid.appendChild(empCard);

    // By Category
    const byCategory = {};
    items.forEach(d => {
      if (!byCategory[d.category]) byCategory[d.category] = { count: 0, total: 0 };
      byCategory[d.category].count++;
      byCategory[d.category].total += d.amount;
    });

    const catCard = el('div', { class: 'bento-item bento-half report-card' });
    catCard.appendChild(el('h3', { text: 'By Category', style: 'margin-top:0;' }));
    const catTable = el('table', { class: 'report-table' });
    catTable.appendChild(el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Category' }),
        el('th', { text: 'Count', class: 'text-center' }),
        el('th', { text: 'Total', class: 'text-center' })
      ])
    ]));
    const catBody = el('tbody');
    Object.entries(byCategory).forEach(([cat, data]) => {
      catBody.appendChild(el('tr', {}, [
        el('td', { text: cat }),
        el('td', { text: String(data.count), class: 'text-center' }),
        el('td', { text: formatPHP(data.total), class: 'text-center' })
      ]));
    });
    catTable.appendChild(catBody);
    catCard.appendChild(catTable);
    grid.appendChild(catCard);

    // Fund split
    const firmItems = items.filter(d => this.getFundSource(d) === 'Firm Fund');
    const clientItems = items.filter(d => this.getFundSource(d) === 'Client Fund');
    const firmTotal = firmItems.reduce((s, d) => s + d.amount, 0);
    const clientTotal = clientItems.reduce((s, d) => s + d.amount, 0);

    const fundCard = el('div', { class: 'bento-item bento-full report-card' });
    fundCard.appendChild(el('h3', { text: 'By Fund Source', style: 'margin-top:0;' }));
    const fundSplitWrap = el('div', { class: 'fund-split', style: 'margin-bottom: var(--spacing-md);' });
    fundSplitWrap.appendChild(el('div', { class: 'fund-box' }, [
      el('div', { class: 'fund-label', text: 'Firm Fund' }),
      el('div', { class: 'fund-value', text: formatPHP(firmTotal) }),
      el('div', { style: 'font-size: 0.8rem; color: var(--color-text-muted);', text: firmItems.length + ' items' })
    ]));
    fundSplitWrap.appendChild(el('div', { class: 'fund-box' }, [
      el('div', { class: 'fund-label', text: 'Client Fund' }),
      el('div', { class: 'fund-value', text: formatPHP(clientTotal) }),
      el('div', { style: 'font-size: 0.8rem; color: var(--color-text-muted);', text: clientItems.length + ' items' })
    ]));
    fundCard.appendChild(fundSplitWrap);
    grid.appendChild(fundCard);

    container.appendChild(grid);
    return container;
  }
};
