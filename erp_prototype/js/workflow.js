const FINANCIAL_ACTION_ICONS = {
  billing: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  disbursement: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg>`,
  transmittal: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`
};

/**
 * Lucide-style SVG icons used by signal modals (info / success / warning / danger).
 * They inherit the modal's type color via currentColor, so every type stays crisp
 * and consistent in both light and dark themes.
 */
const SignalIcons = {
  info: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  success: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 9"/></svg>`,
  warning: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  danger: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
};

const makeToolbarIcon = (svg) => {
  if (!svg) return '';
  if (/class=["']/i.test(svg)) {
    return svg.replace(/class=(["'])(.*?)\1/i, 'class=$1$2 btn-icon-start$1');
  }
  return svg.replace(/^<svg([^>]*)>/i, '<svg$1 class="btn-icon-start">');
};

const FINANCIAL_ACTION_CONFIGS = [
  {
    type: 'billing',
    createPerm: 'billing:edit',
    requestPerm: 'billing:request',
    createTitle: 'Generate Billing',
    requestTitle: 'Request Billing',
    icon: FINANCIAL_ACTION_ICONS.billing,
    createHandler: (wf, wr, t) => wf.openGenerateBillingModal(wr, t)
  },
  {
    type: 'disbursement',
    createPerm: 'disbursement:create',
    requestPerm: 'disbursement:request',
    createTitle: 'Generate Disbursement',
    requestTitle: 'Request Disbursement',
    icon: FINANCIAL_ACTION_ICONS.disbursement,
    createHandler: (wf, wr, t) => wf.openGenerateDisbursementModal(wr, t)
  },
  {
    type: 'transmittal',
    createPerm: 'transmittal:create',
    requestPerm: 'transmittal:request',
    createTitle: 'Generate Transmittal',
    requestTitle: 'Request Transmittal',
    icon: FINANCIAL_ACTION_ICONS.transmittal,
    createHandler: (wf, wr, t) => wf.openGenerateTransmittalModal(wr, t)
  }
];

/**
 * Apply standard disabled treatment to an element for pending-approval state.
 * Sets disabled, opacity, cursor, and tooltip.
 */
function disableForApproval(element, title = 'Under approval') {
  element.disabled = true;
  element.style.opacity = '0.5';
  element.style.cursor = 'not-allowed';
  element.title = title;
}

function isPendingWr(wr) {
  return !!(wr && wr.isPendingApproval);
}

function disableIfPending(element, wr, title = 'Under approval') {
  if (isPendingWr(wr)) {
    disableForApproval(element, title);
    return true;
  }
  return false;
}

/**
 * API-backed data layer for Work Requests and Tasks.
 * Uses window.apiClient.workRequests and window.apiClient.tasks endpoints.
 */
const WorkflowData = {
  _workRequests: null,
  _tasks: null,
  _loadingPromise: null,
  _backgroundPromise: null,
  // Track which entity the in-flight load belongs to so a rapid entity switch
  // cannot return a stale load for the previous entity.
  _loadingEntity: null,
  _loadGeneration: 0,
  // Track which entity the cached work requests belong to so an entity switch
  // cannot accidentally reuse data from a previous entity.
  _entity: null,

  // Pending approvals cache using window.apiClient.pendingApprovals.
  _pendingApprovals: null,
  _pendingApprovalsPromise: null,
  _pendingApprovalsLoadedAt: null,
  PENDING_APPROVALS_TTL_MS: 30 * 1000,

  // Force the next list fetch to bypass browser/service-worker cache. Set by
  // invalidate() and any mutation so navigation after creation sees the new
  // record immediately instead of a stale pre-creation cached response.
  // Initialized to true so every fresh app load (after login, refresh, or new
  // tab) fetches the latest server state rather than a stale browser cache.
  _needsFreshFetch: true,

  normalizeWorkRequest(wr) {
    if (!wr) return wr;
    return {
      ...wr,
      // Backend does not persist these frontend-only fields; supply defaults.
      archived: wr.archived ?? false,
      boardOrder: wr.boardOrder ?? null,
      priority: wr.priority || 'Normal',
      isPendingApproval: wr.isPendingApproval ?? false,
      linkedInvoiceId: wr.linkedInvoiceId || null,
      linkedDisbursementIds: wr.linkedDisbursementIds || [],
      linkedTransmittalIds: wr.linkedTransmittalIds || [],
      tasks: wr.tasks || []
    };
  },

  normalizeTask(task) {
    if (!task) return task;
    return {
      ...task,
      // Preserve frontend-only extensions that the backend strips.
      comments: task.comments || [],
      taskDocuments: (task.taskDocuments || []).map(d => ({
        ...d,
        documentId: d.documentId || null
      })),
      coAssignees: task.coAssignees || [],
      priority: task.priority || 'Normal',
      assignedTo: task.assignedTo || task.assigneeId || null,
      checklist: (task.checklist || []).map(item => ({
        id: item.id || generateUUID(),
        text: item.text || '',
        category: item.category || 'subtask',
        completed: item.completed ?? false,
        assigneeId: item.assigneeId || null,
        assigneeName: item.assigneeName || null,
        dependsOn: Array.isArray(item.dependsOn)
          ? (item.dependsOn[0] || null)
          : (item.dependsOn || null),
        timeLogs: item.timeLogs || []
      }))
    };
  },

  _getActiveEntity() {
    return (typeof Auth !== 'undefined' && Auth.activeEntity) || null;
  },

  _isTempId(id) {
    return typeof id === 'string' && /^(tmp-|wr-|t-|rt-|rtt-)/.test(id);
  },

  _isEntityFresh() {
    return this._entity === this._getActiveEntity();
  },

  hasData() {
    return Array.isArray(this._workRequests) && Array.isArray(this._tasks) && this._isEntityFresh();
  },

  invalidate() {
    this._workRequests = null;
    this._tasks = null;
    this._loadingPromise = null;
    this._loadingEntity = null;
    this._loadGeneration++;
    this._entity = null;
    this._pendingApprovals = null;
    this._pendingApprovalsPromise = null;
    this._pendingApprovalsLoadedAt = null;
    this._needsFreshFetch = true;
  },

  async loadPendingApprovals(force = false) {
    const now = Date.now();
    const fresh = this._pendingApprovalsLoadedAt && (now - this._pendingApprovalsLoadedAt < this.PENDING_APPROVALS_TTL_MS);
    if (!force && this._pendingApprovals && fresh) return this._pendingApprovals;
    if (this._pendingApprovalsPromise) return this._pendingApprovalsPromise;
    this._pendingApprovalsPromise = window.apiClient.pendingApprovals.list({})
      .then(res => {
        this._pendingApprovals = (res?.data || []).map(pc => this._normalizePendingApproval(pc));
        this._pendingApprovalsLoadedAt = Date.now();
        return this._pendingApprovals;
      })
      .catch(err => {
        if (this._isAbortError(err)) {
          if (!this._pendingApprovals) this._pendingApprovals = [];
          return this._pendingApprovals;
        }
        console.error('[WorkflowData] failed to load pending approvals', err);
        if (!this._pendingApprovals) this._pendingApprovals = [];
        return this._pendingApprovals;
      })
      .finally(() => { this._pendingApprovalsPromise = null; });
    return this._pendingApprovalsPromise;
  },

  invalidatePendingApprovals() {
    this._pendingApprovals = null;
    this._pendingApprovalsLoadedAt = null;
    this._pendingApprovalsPromise = null;
  },

  getPendingApprovals() {
    return this._pendingApprovals || [];
  },

  _normalizePendingApproval(pc) {
    if (!pc) return pc;
    return {
      ...pc,
      table: pc.table || pc.tableName,
      tableName: pc.tableName || pc.table,
      submittedAt: pc.submittedAt || pc.createdAt || pc.created_at,
      submittedBy: pc.submittedBy || pc.submitted_by,
      reviewedBy: pc.reviewedBy || pc.reviewed_by,
      reviewedAt: pc.reviewedAt || pc.reviewed_at,
      rejectionReason: pc.rejectionReason || pc.rejection_reason
    };
  },

  getPendingApprovalByRecordId(recordId, tableName = 'workRequests') {
    return (this._pendingApprovals || []).find(pc =>
      pc.tableName === tableName && (pc.parentRecordId === recordId || pc.proposedData?.id === recordId)
    ) || null;
  },

  getPendingApprovalsWhere(predicate) {
    return (this._pendingApprovals || []).filter(predicate);
  },

  async ensure() {
    if (this.hasData()) return;
    const activeEntity = this._getActiveEntity();
    // If a load is already in flight for the current entity, share it.
    if (this._loadingPromise && this._loadingEntity === activeEntity) return this._loadingPromise;
    // Otherwise start a fresh load for the active entity and tag it with a new
    // generation. The finally only clears the in-flight promise when the
    // generation is still the one it started with, so stale loads cannot clobber
    // newer loads started after an invalidate or another entity switch.
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

  async ensurePendingApprovals() {
    return this.loadPendingApprovals();
  },

  async _load(loadGen, options = {}) {
    const entity = this._getActiveEntity();
    await Promise.all([
      window.apiClient.userCache.ensure(),
      window.apiClient.clientCache.ensure()
    ]);
    const listParams = { includeTasks: true, ...options };
    const freshFetch = this._needsFreshFetch;
    if (freshFetch) {
      listParams._t = Date.now();
    }
    const res = await window.apiClient.workRequests.list(listParams);
    const wrs = (res.data || []).map(wr => this.normalizeWorkRequest(wr));
    // Tasks are embedded when includeTasks is true; normalize them in place.
    const tasks = [];
    wrs.forEach(wr => {
      wr.tasks = (wr.tasks || []).map(t => {
        const normalized = this.normalizeTask(t);
        normalized.workRequestId = wr.id;
        return normalized;
      });
      tasks.push(...wr.tasks);
    });
    // If the cache was invalidated, the active entity changed, or a newer load
    // started while this one was in flight, discard the stale result so it
    // cannot overwrite a newer load's data.
    if (loadGen !== this._loadGeneration || this._getActiveEntity() !== entity) {
      return { workRequests: this._workRequests || [], tasks: this._tasks || [], meta: res.meta || {} };
    }
    if (typeof Workflow !== 'undefined' && Workflow._activeSkipGeneration > 0 && Workflow._activeSkipGeneration === Workflow._skipFetchGeneration) {
      return { workRequests: this._workRequests || [], tasks: this._tasks || [], meta: res.meta || {} };
    }
    const cacheWarm = Array.isArray(this._workRequests) && this._entity === entity;
    if (cacheWarm) {
      this._mergeWorkRequests(wrs);
      this._mergeTasks(tasks);
    } else {
      this._workRequests = wrs;
      this._tasks = tasks;
    }
    this._entity = entity;
    if (freshFetch) this._needsFreshFetch = false;
    if (typeof Workflow !== 'undefined') Workflow._refreshCounts();
    return { workRequests: this._workRequests, tasks: this._tasks, meta: res.meta || {} };
  },

  _mergeWorkRequests(serverWrs) {
    if (!Array.isArray(this._workRequests)) this._workRequests = [];
    const existingMap = new Map(this._workRequests.map(wr => [wr.id, wr]));
    const isSkipActive = (typeof Workflow !== 'undefined') && Workflow._activeSkipGeneration > 0 && Workflow._activeSkipGeneration === Workflow._skipFetchGeneration;
    serverWrs.forEach(serverWr => {
      const existing = existingMap.get(serverWr.id);
      if (existing) {
        if (existing.priority && (!serverWr.priority || serverWr.priority === 'Normal')) {
          serverWr.priority = existing.priority;
        }
        const localNewer = existing.updatedAt && serverWr.updatedAt && new Date(existing.updatedAt) > new Date(serverWr.updatedAt);
        if (isSkipActive || localNewer || existing.archived || existing.status === 'Cancelled') {
          const localArchived = existing.archived;
          const localStatus = existing.status;
          Object.assign(existing, serverWr);
          if (localArchived !== undefined) existing.archived = localArchived;
          if (localStatus === 'Cancelled' && !localNewer) existing.status = localStatus;
        } else {
          Object.assign(existing, serverWr);
        }
      } else if (!this._isTempId(serverWr.id)) {
        this._workRequests.push(serverWr);
      }
    });
  },

  _mergeTasks(serverTasks) {
    if (!Array.isArray(this._tasks)) this._tasks = [];
    const existingMap = new Map(this._tasks.map(t => [t.id, t]));
    serverTasks.forEach(serverTask => {
      const existing = existingMap.get(serverTask.id);
      if (existing) {
        // Defensive: if the server returns an empty checklist (because the list
        // endpoint omitted extras), preserve the local checklist rather than
        // overwriting it with [] after a refresh or page switch.
        if (existing.checklist?.length && !serverTask.checklist?.length) {
          serverTask.checklist = existing.checklist;
        }
        Object.assign(existing, serverTask);
      } else if (!this._isTempId(serverTask.id)) {
        this._tasks.push(serverTask);
      }
    });
    // Rebuild task arrays on non-temp work requests so list/board views stay consistent.
    this._workRequests.forEach(wr => {
      if (this._isTempId(wr.id)) return;
      wr.tasks = this._tasks.filter(t => t.workRequestId === wr.id);
    });
  },

  async backgroundRefresh() {
    if (typeof Workflow !== 'undefined' && Workflow._activeSkipGeneration > 0 && Workflow._activeSkipGeneration === Workflow._skipFetchGeneration) {
      return { workRequests: this._workRequests || [], tasks: this._tasks || [] };
    }
    if (this._backgroundPromise) return this._backgroundPromise;
    const loadGen = ++this._loadGeneration;
    this._backgroundPromise = this._load(loadGen).finally(() => {
      if (this._loadGeneration === loadGen) {
        this._backgroundPromise = null;
      }
    });
    return this._backgroundPromise;
  },

  async loadPage(options = {}) {
    const { page = 1, limit = 50, status, clientId, search, sortBy, sortOrder, signal } = options;
    const params = { includeTasks: true, page, limit };
    if (status) params.status = status;
    if (clientId) params.clientId = clientId;
    if (search) params.search = search;
    if (sortBy) params.sortBy = sortBy;
    if (sortOrder) params.sortOrder = sortOrder;
    if (signal) params.signal = signal;
    if (this._needsFreshFetch) {
      params._t = Date.now();
      this._needsFreshFetch = false;
    }
    const res = await window.apiClient.workRequests.list(params);
    const wrs = (res.data || []).map(wr => this.normalizeWorkRequest(wr));
    const tasks = [];
    wrs.forEach(wr => {
      wr.tasks = (wr.tasks || []).map(t => {
        const normalized = this.normalizeTask(t);
        normalized.workRequestId = wr.id;
        return normalized;
      });
      tasks.push(...wr.tasks);
    });
    return { workRequests: wrs, tasks, meta: res.meta || {} };
  },

  getAllWorkRequests() { return this._workRequests || []; },
  getAllTasks() { return this._tasks || []; },
  getWorkRequestById(id) { return (this._workRequests || []).find(r => r.id === id) || null; },
  getTaskById(id) { return (this._tasks || []).find(t => t.id === id) || null; },
  getWorkRequestsWhere(predicate) { return (this._workRequests || []).filter(predicate); },
  getTasksWhere(predicate) { return (this._tasks || []).filter(predicate); },

  _snapshotWorkRequest(id) {
    const wr = this.getWorkRequestById(id);
    return wr ? deepClone(wr) : null;
  },

  _restoreWorkRequest(id, snapshot) {
    if (!this._workRequests) return;
    const idx = this._workRequests.findIndex(r => r.id === id);
    if (snapshot) {
      if (idx >= 0) this._workRequests[idx] = snapshot;
      else this._workRequests.push(snapshot);
    } else if (idx >= 0) {
      this._workRequests.splice(idx, 1);
    }
  },

  getWorkRequestSeqMap() {
    const allWrs = this.getAllWorkRequests();
    const pendingWrs = (this._pendingApprovals || [])
      .filter(pc => pc.status === 'pending' && (pc.table === 'workRequests' || pc.tableName === 'workRequests') && !pc.parentRecordId && pc.proposedData)
      .map(pc => ({ ...pc.proposedData, id: pc.proposedData.id || pc.id }));

    const mapById = new Map();
    allWrs.forEach(wr => { if (wr && wr.id) mapById.set(wr.id, wr); });
    pendingWrs.forEach(wr => { if (wr && wr.id && !mapById.has(wr.id)) mapById.set(wr.id, wr); });

    const sorted = Array.from(mapById.values()).sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      if (ta !== tb) return ta - tb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const seqMap = new Map();
    sorted.forEach((wr, idx) => {
      seqMap.set(wr.id, idx + 1);
    });
    return seqMap;
  },

  getWorkRequestKey(wrId) {
    if (!wrId) return 'WR-1';
    const seqMap = this.getWorkRequestSeqMap();
    const seq = seqMap.get(wrId);
    if (seq) return `WR-${seq}`;
    return 'WR-1';
  },

  async createWorkRequest(record) {
    const localId = record && record.id;
    const payload = { ...record };
    delete payload.id;
    delete payload.tasks;
    const res = await window.apiClient.workRequests.create(payload);
    const created = this.normalizeWorkRequest(res.data);
    let existing = localId ? this.getWorkRequestById(localId) : null;
    if (!existing && localId && this._isTempId(localId) && Array.isArray(this._workRequests)) {
      existing = this._workRequests.find(r => this._isTempId(r.id) && r.title === created.title && r.clientId === created.clientId);
    }
    if (existing) {
      const oldId = existing.id;
      const existingTasks = existing.tasks || [];
      const serverTasks = Array.isArray(created.tasks) && created.tasks.length > 0
        ? created.tasks.map(t => {
            const normalized = this.normalizeTask(t);
            normalized.workRequestId = created.id;
            return normalized;
          })
        : null;
      created.tasks = serverTasks || existingTasks;
      if (existing.priority && (!created.priority || created.priority === 'Normal')) {
        created.priority = existing.priority;
      }
      Object.assign(existing, created);
      if (created.id !== oldId) {
        (this._tasks || []).forEach(t => {
          if (t.workRequestId === oldId) t.workRequestId = created.id;
        });
        this.invalidateRelatedForWorkRequest(oldId);
      }
    } else {
      if (!Array.isArray(created.tasks)) created.tasks = [];
      if (!Array.isArray(this._workRequests)) this._workRequests = [];
      const dupIdx = this._workRequests.findIndex(r => r.id === created.id);
      if (dupIdx >= 0) {
        Object.assign(this._workRequests[dupIdx], created);
      } else {
        this._workRequests.push(created);
      }
    }
    // Keep the cache marked fresh for the active entity after a successful create.
    this._entity = this._getActiveEntity();
    this._needsFreshFetch = true;
    return created;
  },

  _adoptServerWorkRequest(localId, serverWr, serverTasks) {
    if (!Array.isArray(this._workRequests)) this._workRequests = [];
    const existing = localId ? this.getWorkRequestById(localId) : null;
    const normalizedWr = this.normalizeWorkRequest(serverWr);
    if (!Array.isArray(normalizedWr.tasks)) normalizedWr.tasks = [];

    // Capture optimistic tasks BEFORE we rewrite their workRequestId, so we can
    // match server tasks back to the same in-memory object and avoid duplicates.
    const capturedTempTasks = localId && existing
      ? (this._tasks || []).filter(t => t.workRequestId === localId)
      : [];

    // Preserve the optimistic priority when the server response lacks it.
    if (existing && existing.priority && (!normalizedWr.priority || normalizedWr.priority === 'Normal')) {
      normalizedWr.priority = existing.priority;
    }

    if (existing) {
      const oldId = existing.id;
      Object.assign(existing, normalizedWr);
      if (normalizedWr.id !== oldId) {
        (this._tasks || []).forEach(t => {
          if (t.workRequestId === oldId) t.workRequestId = normalizedWr.id;
        });
        this.invalidateRelatedForWorkRequest(oldId);
      }
    } else {
      const dupIdx = this._workRequests.findIndex(r => r.id === normalizedWr.id);
      if (dupIdx >= 0) Object.assign(this._workRequests[dupIdx], normalizedWr);
      else this._workRequests.push(normalizedWr);
    }

    // Keep the in-memory cache fresh for the active entity after adoption.
    this._entity = this._getActiveEntity();
    this._needsFreshFetch = true;

    const finalWrId = normalizedWr.id;
    const parentWr = this.getWorkRequestById(finalWrId);
    if (parentWr) {
      if (!Array.isArray(this._tasks)) this._tasks = [];

      serverTasks.forEach(t => {
        const normalizedTask = this.normalizeTask(t);
        normalizedTask.workRequestId = finalWrId;
        const existingTask = normalizedTask.id ? this.getTaskById(normalizedTask.id) : null;
        // Match by server id first (covers updates), then by captured optimistic
        // task using a stable criterion (title + original temp id, falling back to title).
        const tempTask = !existingTask && capturedTempTasks.length
          ? (capturedTempTasks.find(tk =>
              tk.id && normalizedTask.id && tk.id === normalizedTask.id
            ) ||
            capturedTempTasks.find(tk =>
              tk.title === normalizedTask.title && !tk._adopted
            ) ||
            null)
          : null;

        if (existingTask) {
          Object.assign(existingTask, normalizedTask);
        } else if (tempTask) {
          Object.assign(tempTask, normalizedTask);
          tempTask._adopted = true;
        } else {
          this._tasks.push(normalizedTask);
        }
      });

      // Rebuild the WR task list from the merged in-memory tasks so it contains
      // the same object references held in _tasks, not separate server-copy objects.
      parentWr.tasks = this._tasks.filter(t => t.workRequestId === finalWrId);
    }

    return normalizedWr;
  },

  async createTask(record) {
    const localId = record && record.id;
    const wrId = record.workRequestId;
    const payload = { ...record };
    delete payload.id;
    delete payload.workRequestId;
    delete payload.createdAt;
    delete payload.updatedAt;
    // The backend task schema treats assignee fields as optional strings; null is rejected.
    if (payload.assigneeId == null) delete payload.assigneeId;
    if (payload.assigneeName == null) delete payload.assigneeName;
    if (Array.isArray(payload.checklist)) {
      payload.checklist = payload.checklist.map(item => {
        const clean = { ...item };
        if (clean.assigneeId == null) delete clean.assigneeId;
        if (clean.assigneeName == null) delete clean.assigneeName;
        return clean;
      });
    }
    const res = await window.apiClient.workRequests.createTask(wrId, payload);
    const created = this.normalizeTask(res.data);
    if (!Array.isArray(this._tasks)) this._tasks = [];
    const existing = localId ? this.getTaskById(localId) : null;
    if (existing) {
      if (created.id === localId) {
        Object.assign(existing, created);
      } else {
        const idx = this._tasks.findIndex(t => t.id === localId);
        if (idx >= 0) this._tasks.splice(idx, 1, created);
        else this._tasks.push(created);
      }
    } else {
      this._tasks.push(created);
    }
    const parentWr = this.getWorkRequestById(created.workRequestId || wrId);
    if (parentWr) {
      if (!Array.isArray(parentWr.tasks)) parentWr.tasks = [];
      const wrTaskIdx = parentWr.tasks.findIndex(t => (localId && t.id === localId) || t.id === created.id);
      if (wrTaskIdx >= 0) {
        parentWr.tasks[wrTaskIdx] = created;
      } else {
        parentWr.tasks.push(created);
      }
    }
    this._needsFreshFetch = true;
    return created;
  },

  _addOptimisticWorkRequest(record) {
    const normalized = this.normalizeWorkRequest(record);
    if (!normalized.tasks) normalized.tasks = [];
    if (!Array.isArray(this._workRequests)) this._workRequests = [];
    this._workRequests.push(normalized);
    // Mark the cache as fresh for the active entity so WorkflowData.ensure()
    // does not fire a server fetch and overwrite the optimistic record before
    // the list has a chance to render it.
    this._entity = this._getActiveEntity();
    return normalized;
  },

  _removeWorkRequest(id) {
    if (!Array.isArray(this._workRequests)) return;
    const idx = this._workRequests.findIndex(r => r.id === id);
    if (idx >= 0) this._workRequests.splice(idx, 1);
  },

  _addOptimisticTask(record) {
    const normalized = this.normalizeTask(record);
    if (!Array.isArray(this._tasks)) this._tasks = [];
    this._tasks.push(normalized);
    const wr = this.getWorkRequestById(normalized.workRequestId);
    if (wr) {
      if (!Array.isArray(wr.tasks)) wr.tasks = [];
      wr.tasks.push(normalized);
      // Keep the parent WR cache fresh so a subsequent ensure() does not wipe it.
      this._entity = this._getActiveEntity();
    }
    return normalized;
  },

  _removeTask(id) {
    const existing = this.getTaskById(id);
    if (Array.isArray(this._tasks)) {
      const idx = this._tasks.findIndex(t => t.id === id);
      if (idx >= 0) this._tasks.splice(idx, 1);
    }
    if (existing) {
      const wr = this.getWorkRequestById(existing.workRequestId);
      if (wr && Array.isArray(wr.tasks)) {
        const tidx = wr.tasks.findIndex(t => t.id === id);
        if (tidx >= 0) wr.tasks.splice(tidx, 1);
      }
    }
  },

  async updateWorkRequest(id, changes, options = {}) {
    const existing = this.getWorkRequestById(id);
    const activeGenAtStart = (typeof Workflow !== 'undefined') ? Workflow._activeSkipGeneration : 0;
    const explicitSkipGen = (typeof options === 'object' && options !== null && options.skipGen) ? options.skipGen : null;
    let ownSkipGen = 0;
    if (activeGenAtStart === 0 && (!options || !options.preserveSkip) && typeof Workflow !== 'undefined') {
      ownSkipGen = Workflow._startSkipGeneration();
    }
    if (this._isTempId(id)) {
      // Local-only update for optimistic records; do not call the backend.
      if (existing) {
        const { entity: _ignoredEntity, ...safeChanges } = changes || {};
        Object.assign(existing, safeChanges);
      }
      return existing;
    }
    // The entity of a work request is immutable; do not let caller-supplied
    // `entity` overwrite the existing value or be sent to the backend.
    const { entity: _ignoredEntity, ...safeChanges } = changes || {};
    const updated = { ...(existing || {}), ...safeChanges, id };
    // Snapshot the pre-mutation record so we can roll back on failure.
    const previous = existing ? { ...existing, tasks: (existing.tasks || []).map(t => ({ ...t })) } : null;
    if (existing) Object.assign(existing, safeChanges);
    try {
      const payload = { ...updated };
      delete payload.entity;
      if (payload.description === null) delete payload.description;
      // Scope the mutation to the record's own entity so updates work even when
      // the global active entity is 'ALL'.
      const entityHeader = (existing && existing.entity) || (typeof Auth !== 'undefined' && Auth.activeEntity) || null;
      const res = await window.apiClient.workRequests.update(id, payload, entityHeader ? { headers: { 'X-Active-Entity': entityHeader } } : undefined);
      let normalized = this.normalizeWorkRequest(res.data);
      // Preserve frontend-only fields the backend does not return/persist.
      normalized.tasks = (existing && existing.tasks) || [];
      // Only preserve the local archived flag when the server response omits it.
      // If the server explicitly returns archived=false (e.g., after unarchive), honor it.
      const serverHasArchived = res.data && Object.prototype.hasOwnProperty.call(res.data, 'archived');
      if (!serverHasArchived && existing && existing.archived) {
        normalized = { ...normalized, archived: existing.archived };
      }
      normalized.boardOrder = (existing && existing.boardOrder) ?? normalized.boardOrder;
      normalized.priority = (existing && existing.priority) || normalized.priority || 'Normal';
      normalized.linkedInvoiceId = (existing && existing.linkedInvoiceId) || normalized.linkedInvoiceId || null;
      normalized.linkedDisbursementIds = (existing && existing.linkedDisbursementIds) || normalized.linkedDisbursementIds || [];
      normalized.linkedTransmittalIds = (existing && existing.linkedTransmittalIds) || normalized.linkedTransmittalIds || [];
      if (existing) Object.assign(existing, normalized);
    } catch (e) {
      console.error('Failed to update work request', e);
      // Roll back to the cached state so the next render reflects reality.
      if (previous && existing) {
        Object.assign(existing, previous);
        existing.tasks = previous.tasks;
      }
    }
    // Clear skip generation only if explicitly requested or if updateWorkRequest created its own
    if (typeof Workflow !== 'undefined') {
      if (explicitSkipGen) {
        Workflow._clearSkipGenerationIfLatest(explicitSkipGen);
      } else if (ownSkipGen > 0) {
        Workflow._clearSkipGenerationIfLatest(ownSkipGen);
      }
    }
    this.invalidateRelatedForWorkRequest(id);
    this._needsFreshFetch = true;
    return updated;
  },

  async updateTask(id, changes) {
    const existing = this.getTaskById(id);
    const wrId = existing ? existing.workRequestId : (changes && changes.workRequestId);
    if (this._isTempId(id)) {
      // Local-only update for optimistic records; do not call the backend.
      if (existing) Object.assign(existing, changes);
      return existing;
    }
    if (!wrId) {
      console.error('Cannot update task without work request id', id, changes);
      return existing;
    }
    const updated = { ...(existing || {}), ...changes, id };
    if (existing) Object.assign(existing, changes);
    try {
      const payload = { ...updated };
      delete payload.id;
      delete payload.workRequestId;
      delete payload.createdAt;
      delete payload.updatedAt;
      const res = await window.apiClient.workRequests.updateTask(wrId, id, payload);
      const normalized = this.normalizeTask(res.data);
      if (existing) {
        // Preserve frontend-only extensions the backend strips.
        normalized.comments = existing.comments || [];
        normalized.taskDocuments = existing.taskDocuments || [];
        normalized.coAssignees = existing.coAssignees || [];
        normalized.priority = existing.priority || normalized.priority || 'Normal';
        // Merge backend checklist with local dependency/timeLog/coAssignee extras by id.
        const existingClById = new Map((existing.checklist || []).map(c => [c.id, c]));
        normalized.checklist = (normalized.checklist || []).map(c => {
          const ec = existingClById.get(c.id);
          return ec ? { ...ec, ...c, dependsOn: ec.dependsOn || null, timeLogs: ec.timeLogs || [], coAssignees: ec.coAssignees || [] } : c;
        });
        Object.assign(existing, normalized);
      }
    } catch (e) {
      console.error('Failed to update task', e);
    }
    this.invalidateRelatedForTask(id);
    this._needsFreshFetch = true;
    return updated;
  },

  async deleteWorkRequest(id) {
    const idx = (this._workRequests || []).findIndex(r => r.id === id);
    let removed = null;
    if (idx >= 0) {
      removed = this._workRequests[idx];
      this._workRequests.splice(idx, 1);
    }
    if (this._isTempId(id)) {
      this.invalidateRelatedForWorkRequest(id);
      return;
    }
    try {
      await window.apiClient.workRequests.remove(id);
    } catch (e) {
      console.error('Failed to delete work request', e);
      if (removed && Array.isArray(this._workRequests)) {
        this._workRequests.splice(idx >= 0 ? idx : 0, 0, removed);
      }
    }
    this.invalidateRelatedForWorkRequest(id);
    this._needsFreshFetch = true;
  },

  async deleteTask(id) {
    const existing = this.getTaskById(id);
    const wrId = existing ? existing.workRequestId : null;
    const idx = (this._tasks || []).findIndex(t => t.id === id);
    if (idx >= 0) (this._tasks || []).splice(idx, 1);
    if (existing) {
      const wr = this.getWorkRequestById(existing.workRequestId);
      if (wr && wr.tasks) {
        const tidx = wr.tasks.findIndex(t => t.id === id);
        if (tidx >= 0) wr.tasks.splice(tidx, 1);
      }
    }
    if (this._isTempId(id)) {
      if (wrId) this.invalidateRelatedForWorkRequest(wrId);
      return;
    }
    if (!wrId) return;
    try {
      await window.apiClient.workRequests.removeTask(wrId, id);
    } catch (e) {
      console.error('Failed to delete task', e);
    }
    this.invalidateRelatedForTask(id);
    this.invalidateRelatedForWorkRequest(wrId);
    this._needsFreshFetch = true;
  },

  // ============================================================
  // Related financial / document cache using window.apiClient.*.getRelated endpoints.
  // ============================================================
  _relatedByWr: new Map(),
  _relatedByTask: new Map(),
  _relatedLoading: new Map(),
  _relatedTaskLoading: new Map(),

  _emptyWrRelated() {
    return { invoices: [], disbursements: [], transmittals: [], documents: [] };
  },
  _emptyTaskRelated() {
    return { invoices: [], disbursements: [] };
  },

  _isAbortError(e) {
    return isAbortError(e);
  },

  _normalizeRelatedInvoice(inv) {
    if (!inv) return inv;
    return {
      ...inv,
      id: inv.id,
      invoiceNumber: inv.invoice_number || inv.invoiceNumber || '',
      clientId: inv.client_id || inv.clientId || null,
      workRequestId: inv.work_request_id || inv.workRequestId || null,
      status: inv.status || 'Draft',
      issueDate: inv.issue_date || inv.issueDate || null,
      dueDate: inv.due_date || inv.dueDate || null,
      total: typeof inv.total === 'number' ? inv.total : (parseFloat(inv.total) || 0),
      amountPaid: typeof inv.amount_paid === 'number' ? inv.amount_paid : (parseFloat(inv.amount_paid) || 0),
      balance: typeof inv.balance === 'number' ? inv.balance : (parseFloat(inv.balance) || 0),
      subtotal: typeof inv.subtotal === 'number' ? inv.subtotal : (parseFloat(inv.subtotal) || 0),
      linkedTaskId: inv.linked_task_id || inv.linkedTaskId || null,
    };
  },

  _normalizeRelatedDisbursement(d) {
    if (!d) return d;
    return {
      ...d,
      id: d.id,
      category: d.category || '',
      description: d.description || '',
      amount: typeof d.amount === 'number' ? d.amount : (parseFloat(d.amount) || 0),
      status: d.status || 'Draft',
      fundSource: d.fund_source || d.fundSource || '',
      linkedInvoiceId: d.linked_invoice_id || d.linkedInvoiceId || null,
      linkedWorkRequestId: d.linked_work_request_id || d.linkedWorkRequestId || null,
      clientId: d.client_id || d.clientId || null,
      employeeId: d.employee_id || d.employeeId || null,
      submittedAt: d.submitted_at || d.submittedAt || d.created_at || d.createdAt || null,
      linkedTaskId: d.linked_task_id || d.linkedTaskId || null,
    };
  },

  _normalizeRelatedTransmittal(t) {
    if (!t) return t;
    return {
      ...t,
      id: t.id,
      trackingNumber: t.tracking_number || t.trackingNumber || '',
      status: t.status || 'Draft',
      workRequestId: t.work_request_id || t.workRequestId || null,
      sentAt: t.sent_at || t.sentAt || null,
      clientId: t.client_id || t.clientId || null,
      items: t.items || t.transmittal_items || [],
    };
  },

  _normalizeRelatedDocument(doc) {
    if (!doc) return doc;
    return {
      ...doc,
      id: doc.id,
      fileName: doc.file_name || doc.fileName || '',
      workRequestId: doc.work_request_id || doc.workRequestId || null,
      documentType: doc.document_type || doc.documentType || null,
      category: doc.category || '',
      documentLifecycle: doc.document_lifecycle || doc.documentLifecycle || 'collected',
      lifecycleState: doc.document_lifecycle || doc.documentLifecycle || doc.lifecycleState || 'collected',
      status: doc.status || 'active',
      archived: doc.archived ?? false,
    };
  },

  async _buildRelatedFromApi(wrId) {
    const res = await window.apiClient.workRequests.getRelated(wrId);
    const data = res?.data || {};
    return {
      invoices: (data.invoices || []).map(inv => this._normalizeRelatedInvoice(inv)),
      disbursements: (data.disbursements || []).map(d => this._normalizeRelatedDisbursement(d)),
      transmittals: (data.transmittals || []).map(t => this._normalizeRelatedTransmittal(t)),
      documents: (data.documents || []).map(doc => this._normalizeRelatedDocument(doc)),
    };
  },

  async _buildTaskRelatedFromApi(taskId) {
    const res = await window.apiClient.tasks.getRelated(taskId);
    const data = res?.data || {};
    return {
      invoices: (data.invoices || []).map(inv => this._normalizeRelatedInvoice(inv)),
      disbursements: (data.disbursements || []).map(d => this._normalizeRelatedDisbursement(d)),
    };
  },

  async loadRelatedForWorkRequest(id) {
    if (!id || this._isTempId(id)) return this._emptyWrRelated();
    if (this._relatedByWr.has(id)) return this._relatedByWr.get(id);
    if (this._relatedLoading.has(id)) return this._relatedLoading.get(id);
    const promise = window.apiClient.workRequests.getRelated(id)
      .then(res => {
        const data = res?.data || {};
        const normalized = {
          invoices: (data.invoices || []).map(inv => this._normalizeRelatedInvoice(inv)),
          disbursements: (data.disbursements || []).map(d => this._normalizeRelatedDisbursement(d)),
          transmittals: (data.transmittals || []).map(t => this._normalizeRelatedTransmittal(t)),
          documents: (data.documents || []).map(doc => this._normalizeRelatedDocument(doc)),
        };
        this._relatedByWr.set(id, normalized);
        return normalized;
      })
      .catch(err => {
        if (this._isAbortError(err)) {
          return this._relatedByWr.get(id) || this._emptyWrRelated();
        }
        const fallback = this._emptyWrRelated();
        this._relatedByWr.set(id, fallback);
        return fallback;
      })
      .finally(() => {
        this._relatedLoading.delete(id);
      });
    this._relatedLoading.set(id, promise);
    return promise;
  },

  async loadRelatedForTask(id) {
    if (!id || this._isTempId(id)) return this._emptyTaskRelated();
    if (this._relatedTaskLoading.has(id)) return this._relatedTaskLoading.get(id);
    const task = this.getTaskById(id);
    const wrId = task ? task.workRequestId || task.work_request_id : null;
    const promise = (async () => {
      if (wrId) {
        // Derive from the WR-related cache when available to avoid an extra round trip.
        const wrRelated = await this.loadRelatedForWorkRequest(wrId);
        const filtered = {
          invoices: wrRelated.invoices.filter(inv => inv.linkedTaskId === id),
          disbursements: wrRelated.disbursements.filter(d => d.linkedTaskId === id),
        };
        this._relatedByTask.set(id, filtered);
        return filtered;
      }
      // No parent WR available; fall back to the task endpoint.
      const res = await window.apiClient.tasks.getRelated(id);
      const data = res?.data || {};
      const normalized = {
        invoices: (data.invoices || []).map(inv => this._normalizeRelatedInvoice(inv)),
        disbursements: (data.disbursements || []).map(d => this._normalizeRelatedDisbursement(d)),
      };
      this._relatedByTask.set(id, normalized);
      return normalized;
    })()
      .catch(err => {
        if (this._isAbortError(err)) {
          return this._relatedByTask.get(id) || this._emptyTaskRelated();
        }
        const fallback = this._emptyTaskRelated();
        this._relatedByTask.set(id, fallback);
        return fallback;
      })
      .finally(() => {
        this._relatedTaskLoading.delete(id);
      });
    this._relatedTaskLoading.set(id, promise);
    return promise;
  },

  getRelatedForWorkRequest(id) {
    if (!id || this._isTempId(id)) return this._emptyWrRelated();
    if (this._relatedByWr.has(id)) return this._relatedByWr.get(id);
    // Cold fallback: empty cache, then refresh from the backend asynchronously.
    const fallback = this._emptyWrRelated();
    this._relatedByWr.set(id, fallback);
    this.loadRelatedForWorkRequest(id).catch(() => {});
    return fallback;
  },

  getRelatedForTask(id) {
    if (!id || this._isTempId(id)) return this._emptyTaskRelated();
    if (this._relatedByTask.has(id)) return this._relatedByTask.get(id);
    const task = this.getTaskById(id);
    if (task) {
      const wrId = task.workRequestId || task.work_request_id;
      if (wrId && this._relatedByWr.has(wrId)) {
        const wrRelated = this._relatedByWr.get(wrId);
        const filtered = {
          invoices: wrRelated.invoices.filter(inv => inv.linkedTaskId === id),
          disbursements: wrRelated.disbursements.filter(d => d.linkedTaskId === id),
        };
        this._relatedByTask.set(id, filtered);
        return filtered;
      }
    }
    // Cold fallback: empty cache, then refresh from the backend asynchronously.
    const fallback = this._emptyTaskRelated();
    this._relatedByTask.set(id, fallback);
    this.loadRelatedForTask(id).catch(() => {});
    return fallback;
  },

  invalidateRelatedForWorkRequest(id) {
    this._relatedByWr.delete(id);
    this._relatedLoading.delete(id);
  },

  invalidateRelatedForTask(id) {
    this._relatedByTask.delete(id);
    this._relatedTaskLoading.delete(id);
  },

  invalidateRelated() {
    this._relatedByWr.clear();
    this._relatedByTask.clear();
    this._relatedLoading.clear();
    this._relatedTaskLoading.clear();
  }
};


/**
 * Build a map of tasks keyed by workRequestId for batch canViewWr checks.
 * Avoids N+1 DB lookups when filtering many WRs.
 * Returns { [workRequestId]: Task[] }
 */
function buildTaskMap() {
  const allTasks = WorkflowData.getAllTasks() || [];
  const map = {};
  allTasks.forEach(t => {
    if (!map[t.workRequestId]) map[t.workRequestId] = [];
    map[t.workRequestId].push(t);
  });
  return map;
}

const Workflow = {
  editingId: null,
  disableForApproval(element, title = 'Under approval') {
    disableForApproval(element, title);
  },
  isPendingWr,
  disableIfPending,
  view: 'list',
  _archivePage: 1,
  _archiveLimit: 10,
  _skipFetchGeneration: 0,
  _activeSkipGeneration: 0,
  _archiveRestoreLock: false,

  async _withArchiveLock(fn) {
    if (this._archiveRestoreLock) {
      Workflow.showMessage('Action in progress', 'Please wait for the current archive/restore action to finish.', 'info');
      return;
    }
    this._archiveRestoreLock = true;
    try {
      return await fn();
    } finally {
      this._archiveRestoreLock = false;
    }
  },

  _applyServerRecordToCache(id, serverRecord) {
    if (serverRecord) {
      const norm = WorkflowData.normalizeWorkRequest(serverRecord);
      const current = WorkflowData.getWorkRequestById(id);
      if (current) {
        if ((!norm.tasks || (Array.isArray(norm.tasks) && norm.tasks.length === 0)) && current.tasks) {
          norm.tasks = current.tasks;
        }
        if ((norm.priority === 'Normal' || !norm.priority) && current.priority && current.priority !== 'Normal') {
          norm.priority = current.priority;
        }
        if (!norm.linkedInvoiceId && current.linkedInvoiceId) {
          norm.linkedInvoiceId = current.linkedInvoiceId;
        }
        if ((!norm.linkedDisbursementIds || (Array.isArray(norm.linkedDisbursementIds) && norm.linkedDisbursementIds.length === 0)) && current.linkedDisbursementIds) {
          norm.linkedDisbursementIds = current.linkedDisbursementIds;
        }
        if ((!norm.linkedTransmittalIds || (Array.isArray(norm.linkedTransmittalIds) && norm.linkedTransmittalIds.length === 0)) && current.linkedTransmittalIds) {
          norm.linkedTransmittalIds = current.linkedTransmittalIds;
        }
        const serverHasArchived = Object.prototype.hasOwnProperty.call(serverRecord, 'archived');
        if (!serverHasArchived && current.archived) {
          norm.archived = current.archived;
        }
        if ((norm.boardOrder === null || typeof norm.boardOrder === 'undefined') && current.boardOrder != null) {
          norm.boardOrder = current.boardOrder;
        }
        if ((norm.isPendingApproval === false || typeof norm.isPendingApproval === 'undefined') && current.isPendingApproval) {
          norm.isPendingApproval = current.isPendingApproval;
        }
        Object.assign(current, norm);
      }
    }
  },

  /**
   * Update both the module in-memory cache and the shared work-request cache
   * (used by billing/disbursement selectors) from a confirmed server record.
   * This keeps cross-module dropdowns and the operations list consistent without
   * requiring a manual refresh.
   */
  _syncWorkRequestToCaches(wr) {
    if (!wr) return;
    const existing = WorkflowData.getWorkRequestById(wr.id);
    if (existing) {
      Object.assign(existing, wr);
    }
    if (window.apiClient?.workRequestCache) {
      const cache = window.apiClient.workRequestCache;
      if (!Array.isArray(cache._wrs)) cache._wrs = [];
      const normalized = { ...wr, tasks: wr.tasks || [] };
      const idx = cache._wrs.findIndex(r => r.id === normalized.id);
      if (idx >= 0) cache._wrs[idx] = normalized;
      else cache._wrs.push(normalized);
      cache._loadedAt = Date.now();
    }
    WorkflowData._needsFreshFetch = true;
  },

  /**
   * Update both the module in-memory task cache and the cached copy inside the
   * shared work-request cache so detail/board views and cross-module selectors
   * see the new task state immediately.
   */
  _syncTaskToCaches(task) {
    if (!task) return;
    const existing = WorkflowData.getTaskById(task.id);
    if (existing) {
      Object.assign(existing, task);
    }
    const parentWr = WorkflowData.getWorkRequestById(task.workRequestId);
    if (parentWr && Array.isArray(parentWr.tasks)) {
      const idx = parentWr.tasks.findIndex(t => t.id === task.id);
      if (idx >= 0) parentWr.tasks[idx] = task;
      else parentWr.tasks.push(task);
    }
    if (window.apiClient?.workRequestCache) {
      const cache = window.apiClient.workRequestCache;
      if (Array.isArray(cache._wrs)) {
        const wr = cache._wrs.find(r => r.id === task.workRequestId);
        if (wr) {
          if (!Array.isArray(wr.tasks)) wr.tasks = [];
          const idx = wr.tasks.findIndex(t => t.id === task.id);
          if (idx >= 0) wr.tasks[idx] = task;
          else wr.tasks.push(task);
          cache._loadedAt = Date.now();
        }
      }
    }
    WorkflowData._needsFreshFetch = true;
  },

  /**
   * Invalidate backend-derived counts and refresh sidebar notification badges
   * after a confirmed mutation. Avoids full module cache wipes that can reintroduce
   * stale records on the next render.
   */
  _invalidateCountsAndSidebar() {
    if (window.apiClient?.workRequests?.invalidateCounts) {
      window.apiClient.workRequests.invalidateCounts();
    }
    if (typeof App !== 'undefined' && App.updateSidebarNotifications) {
      App.updateSidebarNotifications().catch(() => {});
    }
  },

  _isActiveWorkRequest(wr) {
    return !!wr && !wr.archived && wr.status !== 'Cancelled';
  },

  _startSkipGeneration() {
    this._skipFetchGeneration++;
    this._activeSkipGeneration = this._skipFetchGeneration;
    if (typeof WorkflowData !== 'undefined') {
      WorkflowData._loadGeneration++;
    }
    return this._activeSkipGeneration;
  },
  _clearSkipGenerationIfLatest(gen) {
    if (this._activeSkipGeneration === gen) {
      this._activeSkipGeneration = 0;
    }
  },
  _resetSkipGenerations() {
    this._skipFetchGeneration = 0;
    this._activeSkipGeneration = 0;
  },

  _counts: null,
  _countsEntity: null,

  _recalcCounts(entity = (typeof Auth !== 'undefined' && Auth.activeEntity) || null) {
    const wrs = (WorkflowData.getAllWorkRequests() || []).filter(r => {
      const rEnt = (r.entity || '').toUpperCase();
      if (!entity) return true;
      if (entity === 'ALL') {
        return (Auth.user?.entities || []).map(ae => ae.toUpperCase()).includes(rEnt);
      }
      return rEnt === entity.toUpperCase();
    });
    return {
      active: wrs.filter(r => !r.archived && r.status !== 'Cancelled').length,
      archived: wrs.filter(r => r.archived || r.status === 'Cancelled').length
    };
  },

  _refreshCounts() {
    if (!WorkflowData.hasData()) {
      this._counts = null;
      this._countsEntity = null;
      return;
    }
    this._counts = this._recalcCounts();
    this._countsEntity = Auth.activeEntity;
  },

  _updateCounts(activeDelta = 0, archivedDelta = 0) {
    if (this._counts && this._countsEntity !== Auth.activeEntity) {
      this._counts = null;
      this._countsEntity = null;
    }
    if (!this._counts) {
      this._refreshCounts();
    }
    if (!this._counts) return;
    this._counts.active = Math.max(0, (this._counts.active || 0) + activeDelta);
    this._counts.archived = Math.max(0, (this._counts.archived || 0) + archivedDelta);
  },

  async _optimisticUpdate(id, patch, apiCall, errorTitle = 'Error') {
    if (WorkflowData._isTempId(id)) {
      Workflow.showMessage('Saving...', 'Please wait for the record to finish saving.', 'info');
      throw new Error('Record is still being saved');
    }
    await WorkflowData.ensure();
    const originalSnapshot = WorkflowData._snapshotWorkRequest(id);
    const wasActive = originalSnapshot ? (!originalSnapshot.archived && originalSnapshot.status !== 'Cancelled') : false;
    const wasArchived = originalSnapshot ? (originalSnapshot.archived || originalSnapshot.status === 'Cancelled') : false;

    const wr = WorkflowData.getWorkRequestById(id);
    if (wr) {
      Object.assign(wr, patch, { updatedAt: new Date().toISOString() });
      this._refreshCounts();
    }

    const isNowActive = wr ? (!wr.archived && wr.status !== 'Cancelled') : false;
    const isNowArchived = wr ? (wr.archived || wr.status === 'Cancelled') : false;

    const activeDelta = (isNowActive ? 1 : 0) - (wasActive ? 1 : 0);
    const archivedDelta = (isNowArchived ? 1 : 0) - (wasArchived ? 1 : 0);
    this._updateCounts(activeDelta, archivedDelta);

    if (this.view === 'detail' && this.detailWrId === id && isNowArchived) {
      location.hash = '#operations';
    }

    const gen = this._startSkipGeneration();
    App.handleRoute();

    try {
      const res = await apiCall();
      if (res?.data) {
        const norm = WorkflowData.normalizeWorkRequest(res.data);
        const current = WorkflowData.getWorkRequestById(id);
        if (current) {
          // Preserve frontend-only extensions the server response may omit.
          if ((!norm.tasks || (Array.isArray(norm.tasks) && norm.tasks.length === 0)) && current.tasks) {
            norm.tasks = current.tasks;
          }
          if ((norm.priority === 'Normal' || !norm.priority) && current.priority && current.priority !== 'Normal') {
            norm.priority = current.priority;
          }
          if (!norm.linkedInvoiceId && current.linkedInvoiceId) {
            norm.linkedInvoiceId = current.linkedInvoiceId;
          }
          if ((!norm.linkedDisbursementIds || (Array.isArray(norm.linkedDisbursementIds) && norm.linkedDisbursementIds.length === 0)) && current.linkedDisbursementIds) {
            norm.linkedDisbursementIds = current.linkedDisbursementIds;
          }
          if ((!norm.linkedTransmittalIds || (Array.isArray(norm.linkedTransmittalIds) && norm.linkedTransmittalIds.length === 0)) && current.linkedTransmittalIds) {
            norm.linkedTransmittalIds = current.linkedTransmittalIds;
          }
          const serverHasArchived = res.data && Object.prototype.hasOwnProperty.call(res.data, 'archived');
          if (!serverHasArchived && current.archived) {
            norm.archived = current.archived;
          }
          if ((norm.boardOrder === null || typeof norm.boardOrder === 'undefined') && current.boardOrder != null) {
            norm.boardOrder = current.boardOrder;
          }
          if ((norm.isPendingApproval === false || typeof norm.isPendingApproval === 'undefined') && current.isPendingApproval) {
            norm.isPendingApproval = current.isPendingApproval;
          }
          Object.assign(current, norm);
        }
      }
      this._clearSkipGenerationIfLatest(gen);
      if (typeof window.apiClient?.workRequests?.invalidateCounts === 'function') {
        window.apiClient.workRequests.invalidateCounts();
      }
      WorkflowData.invalidateRelatedForWorkRequest(id);
      if (typeof window.apiClient?.workRequestCache?.invalidate === 'function') {
        window.apiClient.workRequestCache.invalidate();
      }
      if (typeof App !== 'undefined' && typeof App.updateSidebarNotifications === 'function') {
        App.updateSidebarNotifications().catch(() => {});
      }
      App.handleRoute();
      return res;
    } catch (e) {
      console.error(errorTitle, id, e);
      WorkflowData._restoreWorkRequest(id, originalSnapshot);
      this._updateCounts(-activeDelta, -archivedDelta);
      this._clearSkipGenerationIfLatest(gen);
      App.handleRoute();
      Workflow.showMessage('Error', e.message || errorTitle, 'error');
      throw e;
    }
  },

  async _optimisticDelete(id, apiCall, errorTitle = 'Error') {
    if (WorkflowData._isTempId(id)) {
      Workflow.showMessage('Saving...', 'Please wait for the record to finish saving.', 'info');
      throw new Error('Record is still being saved');
    }
    await WorkflowData.ensure();
    const originalSnapshot = WorkflowData._snapshotWorkRequest(id);
    const wasActive = originalSnapshot ? (!originalSnapshot.archived && originalSnapshot.status !== 'Cancelled') : false;
    const wasArchived = originalSnapshot ? (originalSnapshot.archived || originalSnapshot.status === 'Cancelled') : false;

    WorkflowData._restoreWorkRequest(id, null);
    this._refreshCounts();
    this._updateCounts(wasActive ? -1 : 0, wasArchived ? -1 : 0);

    if (this.view === 'detail' && this.detailWrId === id) {
      location.hash = '#operations';
    }

    const gen = this._startSkipGeneration();
    App.handleRoute();

    try {
      const res = await apiCall();
      this._clearSkipGenerationIfLatest(gen);
      if (typeof window.apiClient?.workRequests?.invalidateCounts === 'function') {
        window.apiClient.workRequests.invalidateCounts();
      }
      WorkflowData.invalidateRelatedForWorkRequest(id);
      if (typeof App !== 'undefined' && typeof App.updateSidebarNotifications === 'function') {
        App.updateSidebarNotifications().catch(() => {});
      }
      App.handleRoute();
      return res;
    } catch (e) {
      console.error(errorTitle, id, e);
      WorkflowData._restoreWorkRequest(id, originalSnapshot);
      this._updateCounts(wasActive ? 1 : 0, wasArchived ? 1 : 0);
      this._clearSkipGenerationIfLatest(gen);
      App.handleRoute();
      Workflow.showMessage('Error', e.message || errorTitle, 'error');
      throw e;
    }
  },

  _navigateToWrDetail(wrId) {
    if (WorkflowData._isTempId(wrId)) {
      this.showMessage('Saving...', 'This work request is still being saved. Please wait a moment.', 'info');
      return;
    }
    location.hash = '#operations/detail/' + wrId;
  },

  // Tell the app shell whether the cached WorkflowData is fresh for the given
  // entity, so it can skip the route skeleton overlay when data is already usable.
  hasCachedData(entity) {
    return typeof WorkflowData !== 'undefined' && WorkflowData.hasData() && WorkflowData._entity === entity;
  },
  detailWrId: null,
  templateEditingId: null,
  selectedTaskId: null,
  expandedTaskIds: new Set(),
  lastRenderedWrId: null,

  _retainerTemplates: null,
  _retainerTemplatesPromise: null,
  _retainerTemplatesEntity: null,
  _retainerTemplatesGeneration: 0,
  _retainerTemplatesBackgroundPromise: null,
  _groundWorkers: null,
  _groundWorkersPromise: null,

  async _loadGroundWorkers() {
    if (this._groundWorkers) return this._groundWorkers;
    if (this._groundWorkersPromise) return this._groundWorkersPromise;
    this._groundWorkersPromise = window.apiClient.groundWorkers.list({})
      .then(res => {
        this._groundWorkers = res.data || [];
        return this._groundWorkers;
      })
      .catch(err => {
        console.error('[Workflow] failed to load ground workers', err);
        this._groundWorkers = [];
        return this._groundWorkers;
      })
      .finally(() => { this._groundWorkersPromise = null; });
    return this._groundWorkersPromise;
  },

  _resolveTemplateEntity(record) {
    const activeEntity = (typeof Auth !== 'undefined' && Auth.activeEntity) || null;
    if (activeEntity && activeEntity !== 'ALL') return activeEntity;
    if (record && record.clientId) {
      const client = window.apiClient.clientCache.getById(record.clientId);
      if (client && client.entity) return client.entity;
    }
    return (Auth.user?.entities?.[0] || 'ATA');
  },

  _entityMatchesRetainerTemplate(t, entity) {
    const tEnt = (t?.entity || '').toUpperCase();
    if (!tEnt) return false;
    if (entity === 'ALL') {
      return (Auth.user?.entities || []).map(e => e.toUpperCase()).includes(tEnt);
    }
    return tEnt === (entity || '').toUpperCase();
  },

  _normalizeRetainerTemplate(doc) {
    if (!doc) return doc;
    const entity = doc.entities?.code || doc.entity_code || doc.entity || (doc.entity_id ? null : null);
    return {
      ...doc,
      entity,
      tasks: doc.tasks || [],
      pfAmount: typeof doc.pf_amount === 'number' ? doc.pf_amount : (parseFloat(doc.pf_amount) || 0),
      clientId: doc.client_id || doc.clientId || null,
      schedule: doc.schedule || null
    };
  },

  _retainerTemplatesFresh() {
    return Array.isArray(this._retainerTemplates) && this._retainerTemplatesEntity === Auth.activeEntity;
  },

  async ensureRetainerTemplates() {
    // Honor the optimistic skip window so a server fetch cannot overwrite a
    // template that was just created locally.
    const skipping = Workflow._activeSkipGeneration > 0 && Workflow._activeSkipGeneration === Workflow._skipFetchGeneration;
    if (skipping || this._retainerTemplatesFresh()) return;
    const activeEntity = (typeof Auth !== 'undefined' && Auth.activeEntity) || null;
    if (this._retainerTemplatesPromise) return this._retainerTemplatesPromise;
    const loadGen = ++this._retainerTemplatesGeneration;
    this._retainerTemplatesPromise = this._loadRetainerTemplates(loadGen).finally(() => {
      if (this._retainerTemplatesGeneration === loadGen) this._retainerTemplatesPromise = null;
    });
    return this._retainerTemplatesPromise;
  },

  async _loadRetainerTemplates(loadGen) {
    const entity = (typeof Auth !== 'undefined' && Auth.activeEntity) || null;
    try {
      const res = await window.apiClient.operations.listTemplates();
      if (loadGen !== this._retainerTemplatesGeneration || (typeof Auth !== 'undefined' && Auth.activeEntity) !== entity) {
        return this._retainerTemplates || [];
      }
      const templates = (res.data || []).map(t => this._normalizeRetainerTemplate(t));
      const cacheWarm = Array.isArray(this._retainerTemplates) && this._retainerTemplatesEntity === entity;
      if (cacheWarm) {
        this._mergeRetainerTemplates(templates);
      } else {
        this._retainerTemplates = templates;
      }
      this._retainerTemplatesEntity = entity;
      return this._retainerTemplates;
    } catch (err) {
      console.error('[Workflow] failed to load retainer templates', err);
      if (loadGen !== this._retainerTemplatesGeneration) return this._retainerTemplates || [];
      if (!Array.isArray(this._retainerTemplates)) this._retainerTemplates = [];
      this._retainerTemplatesEntity = entity;
      return this._retainerTemplates;
    }
  },

  _mergeRetainerTemplates(serverTemplates) {
    if (!Array.isArray(this._retainerTemplates)) this._retainerTemplates = [];
    const existingMap = new Map(this._retainerTemplates.map(t => [t.id, t]));
    serverTemplates.forEach(serverT => {
      const existing = existingMap.get(serverT.id);
      if (existing) Object.assign(existing, serverT);
      else if (!this._isTempId(serverT.id)) this._retainerTemplates.push(serverT);
    });
  },

  async backgroundRefreshRetainerTemplates() {
    if (this._retainerTemplatesBackgroundPromise) return this._retainerTemplatesBackgroundPromise;
    const loadGen = ++this._retainerTemplatesGeneration;
    this._retainerTemplatesBackgroundPromise = this._loadRetainerTemplates(loadGen).finally(() => {
      if (this._retainerTemplatesGeneration === loadGen) this._retainerTemplatesBackgroundPromise = null;
    });
    return this._retainerTemplatesBackgroundPromise;
  },

  _getRetainerTemplateById(id) {
    return (this._retainerTemplates || []).find(t => t.id === id);
  },
  _getGroundWorkerById(id) {
    return (this._groundWorkers || []).find(g => g.id === id);
  },
  _getGroundWorkerByName(name) {
    const trimmed = (name || '').trim().toLowerCase();
    if (!trimmed) return null;
    return (this._groundWorkers || []).find(g => g.name.toLowerCase() === trimmed);
  },
  _getRetainerTemplatesWhere(predicate) {
    return (this._retainerTemplates || []).filter(predicate);
  },
  _getAllGroundWorkers() {
    return this._groundWorkers || [];
  },
  getGroundWorkerNames() {
    return (this._groundWorkers || []).map(g => g.name);
  },
  async _addGroundWorker(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const existing = this._getGroundWorkerByName(trimmed);
    if (existing) return existing;
    try {
      const res = await window.apiClient.groundWorkers.create({ name: trimmed });
      const gw = res.data || { id: generateId('gw'), name: trimmed };
      if (!this._groundWorkers) this._groundWorkers = [];
      this._groundWorkers.push(gw);
      return gw;
    } catch (e) {
      console.error('[Workflow] failed to create ground worker', e);
      return { id: generateId('gw'), name: trimmed };
    }
  },
  async _addRetainerTemplate(record) {
    if (!record || !record.name) return null;
    if (!this._retainerTemplates) this._retainerTemplates = [];
    record.entity = this._resolveTemplateEntity(record);
    this._retainerTemplates.push(record);
    this._retainerTemplatesEntity = Auth.activeEntity;
    const myGen = Workflow._startSkipGeneration();
    App.handleRoute();
    try {
      const res = await window.apiClient.operations.createTemplate(record);
      const created = this._normalizeRetainerTemplate(res.data);
      if (!created.entity) created.entity = record.entity;
      const idx = this._retainerTemplates.findIndex(t => t.id === record.id);
      if (idx >= 0) this._retainerTemplates[idx] = created;
      else this._retainerTemplates.push(created);
      Workflow._clearSkipGenerationIfLatest(myGen);
      App.handleRoute();
      return created;
    } catch (e) {
      console.error('[Workflow] failed to create retainer template', e);
      const idx = this._retainerTemplates.findIndex(t => t.id === record.id);
      if (idx >= 0) this._retainerTemplates.splice(idx, 1);
      Workflow._clearSkipGenerationIfLatest(myGen);
      App.handleRoute();
      this.showMessage('Error', e.message || 'Unable to create retainer template.', 'error');
      return null;
    }
  },
  async _updateRetainerTemplate(id, record) {
    const idx = (this._retainerTemplates || []).findIndex(t => t.id === id);
    if (idx === -1) return null;
    const previous = { ...this._retainerTemplates[idx] };
    const optimistic = { ...previous, ...record, id };
    this._retainerTemplates[idx] = optimistic;
    this._retainerTemplatesEntity = Auth.activeEntity;
    try {
      const res = await window.apiClient.operations.updateTemplate(id, record);
      const updated = this._normalizeRetainerTemplate(res.data);
      if (!updated.entity) updated.entity = previous.entity || this._resolveTemplateEntity(record);
      this._retainerTemplates[idx] = updated;
      return updated;
    } catch (e) {
      console.error('[Workflow] failed to update retainer template', e);
      this._retainerTemplates[idx] = previous;
      this.showMessage('Error', e.message || 'Unable to update retainer template.', 'error');
      return null;
    }
  },
  async _deleteRetainerTemplate(id) {
    const idx = (this._retainerTemplates || []).findIndex(t => t.id === id);
    try {
      await window.apiClient.operations.deleteTemplate(id);
      if (idx !== -1) this._retainerTemplates.splice(idx, 1);
    } catch (e) {
      console.error('[Workflow] failed to delete retainer template', e);
    }
  },

  isCompleted(itemOrTask) {
    return !!(itemOrTask && (itemOrTask.status === 'Completed' || itemOrTask.completed));
  },

  getCompletedClass(itemOrTask) {
    return this.isCompleted(itemOrTask) ? 'is-completed' : '';
  },

  getWorkRequestAssigneeNames(r, taskMap) {
    const names = new Set();
    const assignedUser = r.assignedTo ? window.apiClient.userCache.getById(r.assignedTo) : null;
    if (assignedUser?.name) names.add(assignedUser.name);
    const resolvedTaskMap = taskMap || this._tempTaskMap || buildTaskMap();
    const tasks = resolvedTaskMap[r.id] || [];
    tasks.forEach(t => {
      if (t.assigneeId) {
        const u = window.apiClient.userCache.getById(t.assigneeId);
        if (u?.name) names.add(u.name);
      }
      if (t.assigneeName) names.add(t.assigneeName);
      (t.coAssignees || []).forEach(n => { if (n) names.add(n); });
    });
    return names;
  },

  cleanup() {
    if (this._jiraToolbarClickListener) {
      document.removeEventListener('click', this._jiraToolbarClickListener);
      this._jiraToolbarClickListener = null;
    }
    if (this._syncHeaderTopResizeListener) {
      window.removeEventListener('resize', this._syncHeaderTopResizeListener);
      this._syncHeaderTopResizeListener = null;
    }
    const operationsContainer = document.querySelector('.operations-list-page, .operations-tab-page');
    if (operationsContainer) {
      operationsContainer.querySelectorAll('.jira-group-dropdown, .jira-filter-dropdown').forEach(d => d.classList.add('hidden'));
    }
  },

  standardTaskTemplates: [
    { title: 'Gathering requirements and preparing documents for preprocessing', defaultChecklist: [{ text: 'SEC Certificate', category: 'document' }, { text: 'Articles of Incorporation', category: 'document' }, { text: "Mayor's Permit", category: 'document' }, { text: 'BIR Form 1901/1903', category: 'document' }] },
    { title: 'Gather requirements and prepare documents needed for processing', defaultChecklist: [{ text: 'SEC Certificate', category: 'document' }, { text: "Mayor's Permit", category: 'document' }, { text: 'BIR Form 1901/1903', category: 'document' }, { text: 'Articles of Incorporation', category: 'document' }], coAssignees: ['Employee 1', 'Employee 2', 'Employee 3'] },
    { title: 'Creation of ORUS account', defaultChecklist: [] },
    { title: 'Registration of Books of Accounts', defaultChecklist: [] },
    { title: 'Application and Received of Authority to Print', defaultChecklist: [] },
    { title: 'Pickup of Sales/Service Invoice', defaultChecklist: [] },
    { title: 'Billing', defaultChecklist: [] },
    { title: 'Disbursement', defaultChecklist: [] },
    { title: 'Transmittal', defaultChecklist: [] }
  ],

  /**
   * Builds a typable employee assignee dropdown like the filter tray.
   * Existing ground workers are offered; typing a new name shows an
   * "Add employee: X" option and auto-registers it on selection/Enter/blur.
   * Returns the dropdown wrapper. `onChange` receives { assigneeId: null, assigneeName }.
   */
  async resolveAssignee(name) {
    if (!name) return { id: null, name: null };
    const trimmed = name.trim();
    if (!trimmed) return { id: null, name: null };

    await this._loadGroundWorkers();

    // Check system users first
    const user = ((window.apiClient.userCache._users || []) || [])
      .find(u => (u.name || '').toLowerCase() === trimmed.toLowerCase());
    if (user) return { id: user.id, name: user.name };

    // Check ground workers next
    const gw = this._getGroundWorkerByName(trimmed);
    if (gw) return { id: gw.id, name: gw.name };

    // Generate and register new ground worker
    const newGw = await this._addGroundWorker(trimmed);
    return { id: newGw.id, name: newGw.name };
  },

  /**
   * Builds a typable employee assignee dropdown like the filter tray.
   * Existing ground workers are offered; typing a new name shows an
   * "Add employee: X" option and auto-registers it on selection/Enter/blur.
   * Returns the dropdown wrapper. `onChange` receives { assigneeId, assigneeName }.
   */
  async createGroundWorkerDropdown({ selectedGroundWorkerName, onChange, placeholder = 'Employee...', maxWidth, className, priorityNames = [] } = {}) {
    await Promise.all([
      window.apiClient.userCache.ensure(),
      this._loadGroundWorkers()
    ]);

    const buildOptions = () => {
      const systemUsers = (window.apiClient.userCache._users || []) || [];
      const groundWorkers = this._groundWorkers || [];
      const systemUserNames = systemUsers.map(u => u.name).filter(Boolean);
      const prioritySet = new Set([...(priorityNames || []), ...systemUserNames].filter(Boolean));

      const addedNames = new Set();
      const options = [];

      // Priority 1: System users allowed access to the site (created via admin)
      const sortedSystemUsers = [...systemUsers]
        .filter(u => u.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      sortedSystemUsers.forEach(u => {
        const lowerName = u.name.toLowerCase();
        if (!addedNames.has(lowerName)) {
          options.push({ value: u.id, text: u.name });
          addedNames.add(lowerName);
        }
      });

      // Priority 2: Other priority names not in system users
      const otherPriorityNames = Array.from(prioritySet)
        .filter(name => !addedNames.has(name.toLowerCase()))
        .sort((a, b) => a.localeCompare(b));
      otherPriorityNames.forEach(name => {
        const gw = groundWorkers.find(g => g.name.toLowerCase() === name.toLowerCase());
        options.push({ value: gw ? gw.id : name, text: name });
        addedNames.add(name.toLowerCase());
      });

      // Priority 3: Other ground workers
      const otherGws = groundWorkers
        .filter(gw => !addedNames.has(gw.name.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name));
      otherGws.forEach(gw => {
        options.push({ value: gw.id, text: gw.name });
        addedNames.add(gw.name.toLowerCase());
      });

      return options;
    };

    const dropdown = createSearchableDropdown({
      placeholder,
      options: buildOptions(),
      allowFreeText: true,
      maxWidth,
      addNewLabel: (text) => `Add employee: ${text}`
    });
    if (className) dropdown.classList.add(className);

    let lastAppliedName = (selectedGroundWorkerName || '').trim();

    const applyValue = async () => {
      const val = dropdown.value;
      const text = dropdown.searchText.trim();
      let name = '';
      let resolvedId = null;

      if (val) {
        const u = ((window.apiClient.userCache._users || []) || []).find(user => user.id === val);
        if (u) {
          name = u.name;
          resolvedId = u.id;
        } else {
          const gw = this._getGroundWorkerById(val);
          if (gw) {
            name = gw.name;
            resolvedId = gw.id;
          } else {
            name = val;
          }
        }
      } else if (text) {
        name = text;
      }

      if (name === lastAppliedName) return;

      if (name && !resolvedId) {
        const res = await this.resolveAssignee(name);
        resolvedId = res.id;
        name = res.name;
      }

      lastAppliedName = name;
      onChange({ assigneeId: resolvedId, assigneeName: name || null });
    };

    // Set initial value
    if (selectedGroundWorkerName) {
      const nameLower = selectedGroundWorkerName.toLowerCase();
      const user = ((window.apiClient.userCache._users || []) || [])
        .find(u => (u.name || '').toLowerCase() === nameLower);
      if (user) {
        dropdown.value = user.id;
      } else {
        const gw = this._getGroundWorkerByName(selectedGroundWorkerName);
        if (gw) {
          dropdown.value = gw.id;
        } else {
          dropdown.value = selectedGroundWorkerName;
        }
      }
    } else {
      dropdown.value = '';
    }

    const input = dropdown.querySelector('input');
    let blurTimeout;
    const cancelBlurCommit = () => { if (blurTimeout) clearTimeout(blurTimeout); };

    // Apply only on explicit selection, Enter, or blur — not on every keystroke.
    dropdown.addEventListener('change', () => {
      cancelBlurCommit();
      applyValue().catch(() => {});
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        cancelBlurCommit();
        applyValue().catch(() => {});
      }
    });
    input.addEventListener('blur', () => {
      cancelBlurCommit();
      blurTimeout = setTimeout(() => applyValue().catch(() => {}), 150);
    });
    input.addEventListener('focus', cancelBlurCommit);

    const baseDestroy = dropdown.destroy;
    dropdown.destroy = () => {
      cancelBlurCommit();
      if (typeof baseDestroy === 'function') baseDestroy();
    };

    return dropdown;
  },

  // ============================================================
  // Phase Transition Logic (Robust Business Accounting Logic)
  // ============================================================
  getPhaseTransitionStatus(wrId) {
    if (WorkflowData._isTempId(wrId)) {
      return { canTransition: false, reason: 'Saving...' };
    }
    let wr = WorkflowData.getWorkRequestById(wrId);
    if (!wr) {
      const pc = WorkflowData.getPendingApprovalByRecordId(wrId, 'workRequests');
      if (pc && pc.table === 'workRequests') {
        return { canTransition: false, reason: 'This Work Request is currently staged and awaiting administrator approval.' };
      }
      return null;
    }

    const tasks = WorkflowData.getTasksWhere(t => t.workRequestId === wrId);
    const related = WorkflowData.getRelatedForWorkRequest(wrId);
    const invoices = related.invoices;
    const disbursements = related.disbursements;
    const transmittals = related.transmittals;

    // Four lifecycle stages: Draft -> Pre-processing -> Processing -> Completed.
    // Billing and Disbursement are no longer lifecycle phases; they can be generated
    // multiple times from within Processing / Testing. WRs already in Billing/Disbursement
    // are treated as ready to complete if all financial requirements are satisfied.
    const stages = ['Draft', 'Pre-processing', 'Processing', 'Completed', 'Cancelled'];
    const currentIdx = stages.indexOf(wr.status);
    let nextPhase = stages[currentIdx + 1];

    if (wr.status === 'Cancelled' || wr.status === 'Completed') return { canTransition: false, reason: 'Request is already in a terminal state.' };

    let canTransition = true;
    let missing = [];

    switch (wr.status) {
      case 'Draft':
        if (!wr.clientId) { canTransition = false; missing.push('Client assignment'); }
        if (tasks.length === 0) {
          canTransition = false;
          missing.push('At least one task is required');
        } else {
          const unassignedTasks = tasks.filter(t => !(t.assigneeId || t.assignedTo || t.assigneeName));
          if (unassignedTasks.length > 0) {
            canTransition = false;
            missing.push('All tasks must be assigned before routing');
          }
        }
        break;

      case 'Pre-processing':
        // Rule 2: All requirements gathered
        const reqTasks = tasks.filter(t => t.title.toLowerCase().includes('requirement') || t.title.toLowerCase().includes('gather'));
        reqTasks.forEach(t => {
          if (t.status !== 'Completed') {
            canTransition = false;
            const incompleteNames = getIncompleteChecklistNames(t);
            if (incompleteNames.length > 0) {
              missing.push(`Requirement task "${t.title}" is blocked: ${incompleteNames.join(', ')}`);
            } else {
              missing.push(`Requirement task "${t.title}" is not completed`);
            }
          }
        });
        break;

      case 'Processing':
        // Rule 3: All tasks must be completed
        if (tasks.length === 0) { canTransition = false; missing.push('No tasks defined'); }
        else {
            if (!tasks.every(t => t.status === 'Completed')) {
                canTransition = false;
                missing.push('All processing tasks must be marked as Completed');
            }

            // Task-level Linkage Gate:
            tasks.forEach(t => {
                const title = t.title.toLowerCase();
                const taskRelated = WorkflowData.getRelatedForTask(t.id);
                const hasInv = taskRelated.invoices.length > 0;
                const hasDisb = taskRelated.disbursements.length > 0;

                if ((title.includes('invoice') || title.includes('bill')) && !hasInv) {
                    canTransition = false;
                    missing.push(`Task "${t.title}" requires a linked Service Invoice`);
                }
                if ((title.includes('expense') || title.includes('disburse')) && !hasDisb) {
                    canTransition = false;
                    missing.push(`Task "${t.title}" requires a linked Expense/Disbursement`);
                }
            });
        }
        break;

      case 'Billing':
      case 'Disbursement':
        // Legacy statuses: treat as completing the work request.
        // Requirements mirror the old final-stage checks.
        nextPhase = 'Completed';
        if (invoices.length === 0) {
          canTransition = false;
          missing.push('No linked invoices found — create and link an invoice in the Billing module');
        } else {
          const anySent = invoices.some(inv => ['Sent', 'Partially Paid', 'Paid'].includes(inv.status));
          if (!anySent) {
            canTransition = false;
            missing.push('At least one linked invoice must be Sent, Partially Paid, or Paid');
          }
        }
        const wrLevelDisbursements = WorkflowData.getRelatedForWorkRequest(wrId).disbursements;
        tasks.forEach(t => {
          const title = t.title.toLowerCase();
          if (title.includes('expense') || title.includes('disburse') || title.includes('payment') || title.includes('reimburse')) {
            const hasTaskDisb = WorkflowData.getRelatedForTask(t.id).disbursements.length > 0;
            const hasWrDisb = wrLevelDisbursements.length > 0;
            if (!hasTaskDisb && !hasWrDisb) {
              canTransition = false;
              missing.push(`Task "${t.title}" requires a linked Disbursement record before completion`);
            }
          }
        });
        if (invoices.length > 0 && !invoices.every(inv => inv.status === 'Paid')) {
          canTransition = false;
          const unpaid = invoices.filter(inv => inv.status !== 'Paid');
          unpaid.forEach(inv => {
            missing.push(`Invoice ${inv.invoiceNumber || inv.id} is "${inv.status}" — must be Paid for completion`);
          });
        }
        if (disbursements.length > 0 && !disbursements.every(d => d.status === 'Released')) {
          canTransition = false;
          const unreleased = disbursements.filter(d => d.status !== 'Released');
          unreleased.forEach(d => {
            missing.push(`Disbursement for ${d.category} is "${d.status}" — must be Released for completion`);
          });
        }
        break;
    }

    return { canTransition, missing, nextPhase };
  },

  /**
   * Returns actionable hint text and optional route for a routing blocker message.
   */
  getRoutingHint(blockerMessage) {
    const msg = blockerMessage.toLowerCase();
    if (msg.includes('invoice')) return { text: 'Go to Billing', route: '#billing', action: 'billing' };
    if (msg.includes('disbursement') || msg.includes('expense') || msg.includes('reimburse')) return { text: 'Go to Disbursement', route: '#disbursement', action: 'disbursement' };
    if (msg.includes('task') && msg.includes('completed')) return { text: 'Open Tasks', route: null, action: 'tasks' };
    if (msg.includes('requirement')) return { text: 'Open Tasks', route: null, action: 'tasks' };
    if (msg.includes('client assignment')) return { text: 'Edit Work Request', route: null, action: 'edit_wr' };
    if (msg.includes('employee assignment')) return { text: 'Edit Work Request', route: null, action: 'edit_wr' };
    if (msg.includes('all tasks must be assigned')) return { text: 'Edit Work Request', route: null, action: 'edit_wr' };
    if (msg.includes('at least one task')) return { text: 'Open Tasks', route: null, action: 'tasks' };
    if (msg.includes('no tasks defined')) return { text: 'Open Tasks', route: null, action: 'tasks' };
    if (msg.includes('released')) return { text: 'View Disbursements', route: '#disbursement', action: 'disbursement' };
    return null;
  },

  /**
   * Show a dedicated routing blocker modal with actionable next steps and a cancel button.
   * @param {string} title
   * @param {string|string[]} blockers - blocker message(s)
   * @param {Object} [ctx] - optional context { wrId }
   */
  showRoutingBlocker(title, blockers, ctx = {}) {
    const messages = Array.isArray(blockers) ? blockers : [blockers];
    const wrapper = el('div', { class: 'modal-message-wrapper type-warning' });
    const icon = el('div', { class: 'modal-icon-v2', html: SignalIcons.warning });
    wrapper.appendChild(icon);

    const body = el('div', { class: 'modal-text', style: 'text-align:left; width:100%;' });
    body.appendChild(el('p', { text: 'Resolve the following before routing:', style: 'margin-bottom:8px; font-weight:600;' }));
    const list = el('ul', { class: 'routing-blocker-list', style: 'margin:0 0 12px 0; padding-left:20px; line-height:1.5;' });
    messages.forEach(m => list.appendChild(el('li', { text: m })));
    body.appendChild(list);
    wrapper.appendChild(body);

    // Build actionable hints from blocker messages so each blocker can offer a next step.
    const hints = [];
    messages.forEach(m => {
      const hint = this.getRoutingHint(m);
      if (hint && !hints.some(h => h.action === hint.action)) hints.push(hint);
    });

    // Footer is centered via CSS (.modal-message-wrapper .modal-footer); keep it unstyled
    // so the action + cancel buttons line up in the middle of the modal.
    const footer = el('div', { class: 'modal-footer' });

    hints.forEach(hint => {
      const actionBtn = el('button', {
        class: 'btn btn-primary modal-btn-action',
        text: hint.text
      });
      actionBtn.addEventListener('click', () => {
        const overlay = actionBtn.closest('.modal-overlay');
        if (overlay) overlay.remove();
        if (hint.route) {
          location.hash = hint.route;
        } else if (hint.action === 'edit_wr' && ctx.wrId) {
          location.hash = '#operations/form/' + ctx.wrId;
        } else if (hint.action === 'tasks' && ctx.wrId) {
          location.hash = '#operations/detail/' + ctx.wrId;
        }
      });
      footer.appendChild(actionBtn);
    });

    const cancelBtn = el('button', { class: 'btn modal-btn-cancel', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => {
      const overlay = cancelBtn.closest('.modal-overlay');
      if (overlay) overlay.remove();
    });
    footer.appendChild(cancelBtn);

    wrapper.appendChild(footer);

    // Dismiss any existing modal with the same title so fresh blocker content is always shown.
    document.querySelectorAll('.modal-overlay').forEach(o => {
      const titleEl = o.querySelector('.modal-title');
      if (titleEl && titleEl.textContent.trim() === title.trim()) o.remove();
    });

    this.showModal(title, wrapper);
  },

  canRequestPhaseRouting() {
    const role = Auth.user?.role;
    if (role === 'Admin') return false;
    return Auth.can('workflow:edit') || Auth.can('workflow:task_add') || Auth.can('workflow:task_approve');
  },

  requestPhaseRouting(wrId, nextPhase) {
    const wr = WorkflowData.getWorkRequestById(wrId);
    if (!wr) return;
    const existing = WorkflowData.getPendingApprovalsWhere(pc =>
      pc.status === 'pending' && pc.table === 'workRequestPhaseRouting' && pc.parentRecordId === wrId
    )[0];
    if (existing) {
      this.showMessage('Request Pending', 'A phase routing request for this work request is already pending Admin approval.', 'warning');
      return;
    }

    const record = {
      id: wrId,
      status: nextPhase,
      previousStatus: wr.status,
      requestedAt: new Date().toISOString()
    };
    PendingChanges.submit('workRequestPhaseRouting', record, false);
    this.showMessage('Routing Requested', `Phase routing to "${nextPhase}" has been submitted for Admin approval.`, 'success');
  },

  transitionWorkRequest(wrId) {
    const status = this.getPhaseTransitionStatus(wrId);
    if (!status || !status.canTransition) {
      const blockers = status?.missing?.length ? status.missing : ['Requirements not met'];
      this.showRoutingBlocker('Routing Blocked', blockers, { wrId: wrId });
      return;
    }

    const canRouteDirectly = Auth.user?.role === 'Admin' || Auth.isManagerial() || Auth.can('workflow:approve');
    if (canRouteDirectly) {
      this.showConfirm('Confirm Routing', `Are you sure you want to transition this Work Request to ${status.nextPhase}?`, async () => {
        const wr = WorkflowData.getWorkRequestById(wrId);
        await this.runBlockingArchiveAction({
          title: 'Routing Work Request',
          message: `Please wait while "${wr?.title || 'the Work Request'}" is being routed to ${status.nextPhase}...`,
          apiCall: async () => {
            const res = await WorkflowData.updateWorkRequest(wrId, {
              status: status.nextPhase,
              updatedAt: new Date().toISOString()
            });
            this._syncWorkRequestToCaches(res);
            return { data: res };
          },
          successTitle: 'Routed',
          successMessage: `Work Request has been routed to ${status.nextPhase}.`,
          errorTitle: 'Routing Failed'
        });
        this._invalidateCountsAndSidebar();
        App.handleRoute();
      }, 'success');
      return;
    }

    if (this.canRequestPhaseRouting()) {
      this.showConfirm('Request Phase Routing', `Submit request to route this Work Request to ${status.nextPhase}? An Admin must approve it.`, () => {
        this.requestPhaseRouting(wrId, status.nextPhase);
        App.handleRoute();
      }, 'success');
      return;
    }

    this.showMessage('Permission Denied', 'Only Admin can route work request phases.', 'danger');
  },

  cancelWorkRequest(wrId) {
    if (!Auth.isManagerial()) {
      this.showMessage('Permission Denied', 'Only managerial users can cancel work requests.', 'danger');
      return;
    }
    const wr = WorkflowData.getWorkRequestById(wrId);
    if (!wr) return;
    if (wr.status === 'Completed' || wr.status === 'Cancelled') {
      this.showMessage('Error', 'Work Request is already in a terminal state.', 'danger');
      return;
    }

    this.showConfirm('Cancel Work Request',
      `Are you sure you want to cancel "${wr.title}"? All non-completed tasks will also be cancelled.`,
      async () => {
        const now = new Date().toISOString();
        const tasks = WorkflowData.getTasksWhere(t => t.workRequestId === wrId);
        // Snapshot cancellable tasks so we can roll them back if the WR update fails.
        const taskSnapshots = [];
        let cancelledCount = 0;

        for (const t of tasks) {
          if (t.status !== 'Completed' && t.status !== 'Cancelled') {
            taskSnapshots.push({ id: t.id, status: t.status });
            await WorkflowData.updateTask(t.id, { status: 'Cancelled', updatedAt: now });
            cancelledCount++;
          }
        }

        try {
          await this._optimisticUpdate(
            wrId,
            { status: 'Cancelled', archived: true },
            () => window.apiClient.workRequests.update(wrId, { status: 'Cancelled', archived: true }),
            'Failed to cancel Work Request'
          );
          this.showMessage('Work Request Cancelled',
            `Work Request moved to Cancelled. ${cancelledCount} task(s) were also cancelled.`,
            'warning'
          );
        } catch (e) {
          // Roll back the optimistically cancelled tasks if the WR update failed.
          for (const snapshot of taskSnapshots) {
            const task = WorkflowData.getTaskById(snapshot.id);
            if (task) task.status = snapshot.status;
          }
          this.showMessage('Cancel Failed', 'Work Request could not be cancelled; task statuses have been restored.', 'error');
        }
      },
      'danger'
    );
  },

  archiveWorkRequest(wrId) {
    const wr = WorkflowData.getWorkRequestById(wrId);
    if (!wr || wr.archived || wr.status !== 'Completed') return;
    this.showConfirm('Archive Work Request',
      `Are you sure you want to archive "${wr.title || '(untitled)'}"?`,
      async () => {
        await this._withArchiveLock(async () => {
          await this.runBlockingArchiveAction({
            title: 'Archiving Work Request',
            message: `Please wait while "${wr.title || 'Work Request'}" is being archived...`,
            apiCall: () => window.apiClient.workRequests.archive(wrId),
            successTitle: 'Archived',
            successMessage: 'Work Request has been archived.',
            errorTitle: 'Failed to Archive Work Request',
            onSuccess: async (res) => {
              this._applyServerRecordToCache(wrId, res?.data);
            },
            onAfterConfirm: async () => {
              if (window.apiClient?.workRequestCache?.invalidate) window.apiClient.workRequestCache.invalidate();
              if (window.apiClient?.workRequests?.invalidateCounts) window.apiClient.workRequests.invalidateCounts();
              if (typeof WorkflowData.invalidateRelatedForWorkRequest === 'function') {
                WorkflowData.invalidateRelatedForWorkRequest(wrId);
              }
              App.updateSidebarNotifications().catch(() => {});
              if (this.view === 'detail' && this.detailWrId === wrId) {
                location.hash = '#operations';
              } else {
                App.handleRoute();
              }
            }
          });
        });
      },
      'warning'
    );
  },

  unarchiveWorkRequest(wrId) {
    const wr = WorkflowData.getWorkRequestById(wrId);
    if (!wr || !wr.archived) return;
    this.showConfirm('Restore Work Request',
      `Are you sure you want to restore "${wr.title || '(untitled)'}"?`,
      async () => {
        await this._withArchiveLock(async () => {
          await this.runBlockingArchiveAction({
            title: 'Restoring Work Request',
            message: `Please wait while "${wr.title || 'Work Request'}" is being restored...`,
            apiCall: () => window.apiClient.workRequests.unarchive(wrId),
            successTitle: 'Restored',
            successMessage: 'Work Request has been restored to the active list.',
            errorTitle: 'Failed to Restore Work Request',
            onSuccess: async (res) => {
              this._applyServerRecordToCache(wrId, res?.data);
            },
            onAfterConfirm: async () => {
              if (window.apiClient?.workRequestCache?.invalidate) window.apiClient.workRequestCache.invalidate();
              if (window.apiClient?.workRequests?.invalidateCounts) window.apiClient.workRequests.invalidateCounts();
              if (typeof WorkflowData.invalidateRelatedForWorkRequest === 'function') {
                WorkflowData.invalidateRelatedForWorkRequest(wrId);
              }
              App.updateSidebarNotifications().catch(() => {});
              App.handleRoute();
            }
          });
        });
      },
      'warning'
    );
  },

  bulkArchiveWorkRequests(ids) {
    const eligible = (ids || [])
      .map(id => WorkflowData.getWorkRequestById(id))
      .filter(wr => wr && wr.status === 'Completed' && !wr.archived);

    if (eligible.length === 0) {
      this.showMessage('No eligible records', 'Only Completed Work Requests can be archived.', 'info');
      return;
    }

    this.showConfirm('Bulk Archive',
      `Are you sure you want to archive ${eligible.length} Work Request(s)?`,
      async () => {
        await this._withArchiveLock(async () => {
          let successCount = 0;
          let failCount = 0;
          await this.runBlockingArchiveAction({
            title: 'Archiving Work Requests',
            message: `Please wait while ${eligible.length} Work Request(s) are being archived...`,
            apiCall: async () => {
              for (const wr of eligible) {
                try {
                  const res = await window.apiClient.workRequests.archive(wr.id);
                  this._applyServerRecordToCache(wr.id, res?.data);
                  successCount++;
                } catch (e) {
                  console.error('Failed to archive Work Request', wr.id, e);
                  failCount++;
                }
              }
              if (failCount > 0 && successCount === 0) {
                return { error: { message: `${failCount} Work Request(s) could not be archived.` } };
              }
              return { data: { successCount, failCount } };
            },
            successTitle: 'Archived',
            successMessage: failCount > 0
              ? `${successCount} Work Request(s) archived, ${failCount} failed.`
              : `${eligible.length} Work Request(s) archived.`,
            errorTitle: 'Archive Failed',
            onAfterConfirm: async () => {
              if (window.apiClient?.workRequestCache?.invalidate) window.apiClient.workRequestCache.invalidate();
              if (window.apiClient?.workRequests?.invalidateCounts) window.apiClient.workRequests.invalidateCounts();
              eligible.forEach(wr => {
                if (typeof WorkflowData.invalidateRelatedForWorkRequest === 'function') {
                  WorkflowData.invalidateRelatedForWorkRequest(wr.id);
                }
              });
              App.updateSidebarNotifications().catch(() => {});
              App.handleRoute();
            }
          });
        });
      },
      'warning'
    );
  },

  bulkCancelWorkRequests(ids) {
    if (!Auth.isManagerial()) {
      this.showMessage('Permission Denied', 'Only Admin can cancel work requests.', 'danger');
      return;
    }

    const eligible = (ids || [])
      .map(id => WorkflowData.getWorkRequestById(id))
      .filter(wr => wr && wr.status !== 'Completed' && wr.status !== 'Cancelled');

    if (eligible.length === 0) {
      this.showMessage('No eligible records', 'Only active Work Requests can be cancelled.', 'info');
      return;
    }

    this.showConfirm('Bulk Cancel',
      `Are you sure you want to cancel ${eligible.length} Work Request(s) and their non-completed tasks?`,
      async () => {
        const now = new Date().toISOString();
        let cancelledTasks = 0;

        const myGen = Workflow._startSkipGeneration();
        this._updateCounts(-eligible.length, eligible.length);
        App.handleRoute();

        let failedCount = 0;
        await Promise.all(eligible.map(async wr => {
          try {
            const tasks = WorkflowData.getTasksWhere(t => t.workRequestId === wr.id);
            await Promise.all(tasks.map(async t => {
              if (t.status !== 'Completed' && t.status !== 'Cancelled') {
                await WorkflowData.updateTask(t.id, { status: 'Cancelled', updatedAt: now });
                cancelledTasks++;
              }
            }));
            await WorkflowData.updateWorkRequest(wr.id, { status: 'Cancelled', archived: true, updatedAt: now });
            const updated = WorkflowData.getWorkRequestById(wr.id);
            if (!updated || updated.status !== 'Cancelled' || !updated.archived) {
              failedCount++;
            }
          } catch (e) {
            failedCount++;
            console.error('Failed to cancel work request', wr.id, e);
          }
        }));

        if (failedCount > 0) {
          this._updateCounts(failedCount, -failedCount);
        }

        Workflow._clearSkipGenerationIfLatest(myGen);
        App.handleRoute();
        if (typeof window.apiClient?.workRequestCache?.invalidate === 'function') {
          window.apiClient.workRequestCache.invalidate();
        }

        this.showMessage('Cancelled',
          `${eligible.length} Work Request(s) cancelled. ${cancelledTasks} task(s) also cancelled.`,
          'warning'
        );
      },
      'danger'
    );
  },

  /**
   * Open a centered modal with a title and arbitrary body content.
   * Returns the overlay element so callers can remove it.
   */
  showModal(title, bodyEl, onClose) {
    // Prevent duplicate modals with the same title
    const existing = Array.from(document.querySelectorAll('.modal-overlay')).find(o => {
      const titleEl = o.querySelector('.modal-title');
      return titleEl && titleEl.textContent.trim() === title.trim();
    });
    if (existing) return existing;

    const overlay = el('div', { class: 'modal-overlay' });
    const modal = el('div', { class: 'modal' });
    const header = el('div', { class: 'modal-header' });
    header.appendChild(el('h3', { class: 'modal-title', text: title }));
    const closeBtn = el('button', { class: 'btn btn-secondary btn-sm', text: '✕' });
    closeBtn.addEventListener('click', () => { overlay.remove(); if (onClose) onClose(); });
    header.appendChild(closeBtn);
    modal.appendChild(header);
    const body = el('div', { class: 'modal-body' });
    body.appendChild(bodyEl);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); if (onClose) onClose(); }
    });
    return overlay;
  },

  showMessage(title, message, type = 'info') {
    const wrapper = el('div', { class: `modal-message-wrapper type-${type}` });
    const icon = el('div', { class: 'modal-icon-v2', html: SignalIcons[type] || SignalIcons.info });
    wrapper.appendChild(icon);

    wrapper.appendChild(el('p', { text: message, class: 'modal-text' }));

    const footer = el('div', { class: 'modal-footer' });
    const okBtn = el('button', { class: 'btn btn-primary modal-btn-sure', text: 'OK' });
    footer.appendChild(okBtn);
    wrapper.appendChild(footer);

    const overlay = this.showModal(title, wrapper);
    okBtn.addEventListener('click', () => overlay.remove());
  },

  showBlockingOverlay(title, message) {
    const overlay = el('div', { class: 'modal-overlay blocking-modal-overlay' });
    const modal = el('div', { class: 'modal blocking-overlay-card' });

    const body = el('div', { class: 'modal-body', style: 'display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 4px 8px 8px 8px; text-align: center;' });
    
    // Modern Dual-Orbital Spinner
    const spinnerWrapper = el('div', { style: 'position: relative; padding: 12px 0;' });
    const spinner = el('div', { class: 'loading-spinner blocking-spinner' });
    spinnerWrapper.appendChild(spinner);
    body.appendChild(spinnerWrapper);

    // Title & Message with Notion/Jira Typography
    const textContainer = el('div', { style: 'display: flex; flex-direction: column; gap: 6px; width: 100%;' });
    const titleEl = el('h3', { class: 'blocking-loading-title', text: title, style: 'margin: 0; font-size: 1.125rem; font-weight: 700; letter-spacing: -0.01em; color: var(--color-text);' });
    const messageEl = el('p', { class: 'blocking-loading-message', text: message, style: 'margin: 0; font-size: 0.875rem; color: var(--color-text-muted); font-weight: 450; line-height: 1.5;' });
    textContainer.appendChild(titleEl);
    textContainer.appendChild(messageEl);
    body.appendChild(textContainer);

    // Jira-inspired Shimmer Progress Track
    const shimmerBar = el('div', { class: 'loading-shimmer-bar' });
    body.appendChild(shimmerBar);

    modal.appendChild(body);
    overlay.appendChild(modal);

    document.body.appendChild(overlay);
    document.body.setAttribute('aria-busy', 'true');

    return {
      overlay,
      close: () => {
        document.body.removeAttribute('aria-busy');
        if (overlay && overlay.parentNode) {
          overlay.remove();
        }
      }
    };
  },

  hideBlockingOverlay(overlayObj) {
    if (overlayObj && typeof overlayObj.close === 'function') {
      overlayObj.close();
    } else if (overlayObj && overlayObj.remove) {
      document.body.removeAttribute('aria-busy');
      overlayObj.remove();
    }
  },

  async runBlockingArchiveAction({
    title,
    message,
    apiCall,
    successTitle,
    successMessage,
    errorTitle,
    onSuccess,
    onAfterConfirm
  }) {
    const overlayObj = this.showBlockingOverlay(title, message);
    try {
      let timedOut = false;
      let timerId = null;

      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => {
          timedOut = true;
          reject(new Error('The request timed out. Please try again.'));
        }, 30000);
      });

      const apiPromise = apiCall().then(
        result => {
          if (timerId) clearTimeout(timerId);
          if (timedOut) return null;
          return result;
        },
        err => {
          if (timerId) clearTimeout(timerId);
          if (timedOut) return null;
          throw err;
        }
      );

      const res = await Promise.race([apiPromise, timeoutPromise]);
      this.hideBlockingOverlay(overlayObj);

      if (res && res.error) {
        this.showMessage(errorTitle || 'Action Failed', res.error.message || String(res.error), 'error');
        return { success: false, error: res.error };
      }

      if (onSuccess) {
        await onSuccess(res);
      }

      await new Promise((resolve) => {
        const wrapper = el('div', { class: 'modal-message-wrapper type-success' });
        const icon = el('div', { class: 'modal-icon-v2', html: SignalIcons.success || '' });
        wrapper.appendChild(icon);
        wrapper.appendChild(el('p', { text: successMessage, class: 'modal-text' }));

        const footer = el('div', { class: 'modal-footer' });
        const okBtn = el('button', { class: 'btn btn-primary modal-btn-sure', text: 'OK' });
        footer.appendChild(okBtn);
        wrapper.appendChild(footer);

        const overlay = el('div', { class: 'modal-overlay' });
        const modal = el('div', { class: 'modal' });
        const header = el('div', { class: 'modal-header' });
        header.appendChild(el('h3', { class: 'modal-title', text: successTitle }));
        modal.appendChild(header);
        const body = el('div', { class: 'modal-body' });
        body.appendChild(wrapper);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        okBtn.addEventListener('click', () => {
          overlay.remove();
          resolve();
        });
      });

      if (onAfterConfirm) {
        await onAfterConfirm(res);
      }

      return { success: true, data: res ? res.data : null };
    } catch (err) {
      this.hideBlockingOverlay(overlayObj);
      console.error('Blocking archive action failed:', err);
      this.showMessage(errorTitle || 'Action Failed', err.message || 'An unexpected error occurred.', 'error');
      return { success: false, error: err };
    }
  },

  toggleChecklistItem(task, itemId, isCompleted) {
    if (!task) return;
    const checklist = task.checklist || [];
    const item = checklist.find(c => c.id === itemId);
    if (!item) return;

    item.completed = !!isCompleted;
    if (!isCompleted) {
      checklist.forEach(other => {
        if (isChecklistBlocked(other, checklist)) {
          other.completed = false;
        }
      });
    }

    WorkflowData.updateTask(task.id, { checklist: checklist, updatedAt: new Date().toISOString() });
  },

  ensureTaskChecklistNormalized(task, persist = false) {
    if (!task) return;
    const checklist = task.checklist || [];
    const hasUnnormalized = checklist.some(item =>
      typeof item === 'string' ||
      !item.id ||
      !('completed' in item) ||
      !('dependsOn' in item) ||
      !('timeLogs' in item) ||
      !('category' in item)
    );
    if (hasUnnormalized) {
      const normalized = checklist.map(item => {
        const text = typeof item === 'string' ? item : (item.text || '');
        const id = (typeof item === 'object' && item && item.id) ? item.id : generateUUID();

        return {
          id: id,
          text: text,
          category: typeof item === 'object' && item ? (item.category || 'subtask') : 'subtask',
          completed: typeof item === 'object' && item ? !!item.completed : false,
          assigneeId: typeof item === 'object' && item ? item.assigneeId || null : null,
          assigneeName: typeof item === 'object' && item ? item.assigneeName || null : null,
          dependsOn: typeof item === 'object' && item ? item.dependsOn || null : null,
          timeLogs: typeof item === 'object' && item ? item.timeLogs || [] : []
        };
      });

      task.checklist = normalized;
      if (persist && task.id && !task.id.startsWith('tmp')) {
        WorkflowData.updateTask(task.id, { checklist: normalized, updatedAt: new Date().toISOString() });
      }
    }
  },

  renderChecklistView(filteredTasks, isArchived) {
    // Ensure all tasks have normalized checklists before rendering
    filteredTasks.forEach(t => {
      this.ensureTaskChecklistNormalized(t, true);
    });

    const clContainer = el('div', { class: 'checklist-view-container', style: 'margin-top: 16px; display: flex; flex-direction: column; gap: var(--space-3);' });

    if (filteredTasks.length === 0) {
      clContainer.appendChild(renderEmptyStateV2({
        variant: 'zero-state',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>',
        title: 'No tasks found',
        body: 'Adjust your filters or add a task to see it here.'
      }));
    } else {
      filteredTasks.forEach(t => {
        const taskCard = el('div', { class: 'checklist-view-item-wrap' });
        
        // Primary Task Row
        const taskRow = el('div', { class: classNames('checklist-view-row', 'task-level', this.getCompletedClass(t)) });
        
        if (window.SidePaneInstance && window.SidePaneInstance.isOpen() && window.SidePaneInstance.recordId === t.id) {
          taskRow.classList.add('side-pane-active');
          window.SidePaneInstance.activeElement = taskRow;
        }

        // Task Checkbox
        const taskCb = el('input', { type: 'checkbox', class: 'checklist-view-cb' });
        taskCb.checked = t.status === 'Completed';
        taskCb.disabled = isArchived;
        taskCb.addEventListener('click', (e) => e.stopPropagation());
        taskCb.addEventListener('change', () => {
          const nextStatus = taskCb.checked ? 'Completed' : 'In Progress';
          this.showConfirm('Confirm Status Change',
            `Are you sure you want to mark this task as "${nextStatus}"?`,
            () => {
              const res = this.updateTaskStatus(t.id, nextStatus);
              if (res.error) {
                this.showMessage('Error', res.error, 'danger');
                taskCb.checked = !taskCb.checked;
              } else {
                App.handleRoute();
              }
            },
            'warning',
            () => { taskCb.checked = !taskCb.checked; }
          );
        });
        taskRow.appendChild(taskCb);
        
        // Task Title
        const titleEl = el('div', { class: 'checklist-view-title', text: t.title });
        taskRow.appendChild(titleEl);
        
        // Task Meta Details
        const metaWrap = el('div', { class: 'checklist-view-meta' });
        
        // Priority Badge
        const pClass = { 'Urgent': 'badge-danger', 'Priority': 'badge-warn', 'Low Priority': 'badge-info' }[t.priority] || 'badge-muted';
        metaWrap.appendChild(el('span', { class: `badge ${pClass}`, text: t.priority || 'Normal' }));
        
        // Due date
        if (t.dueDate) {
          metaWrap.appendChild(el('span', { class: 'checklist-view-date', text: formatDate(t.dueDate) }));
        }
        
        // Assignees
        const allAssigneeNames = getTaskAllAssigneeNames(t);
        if (allAssigneeNames.length > 0) {
          metaWrap.appendChild(this.renderAssigneeAvatarsList(allAssigneeNames));
        }
        
        taskRow.appendChild(metaWrap);
        
        // Click to open Task Details
        taskRow.addEventListener('click', () => {
          this.showTaskSidePane(t.id, taskRow);
        });
        
        taskCard.appendChild(taskRow);
        
        // Sub-checklist items nested
        const normalizedCL = t.checklist || [];
        
        if (normalizedCL.length > 0) {
          const subItemsWrap = el('div', { class: 'checklist-view-sub-container' });
          
          normalizedCL.forEach(item => {
            const blocked = isChecklistBlocked(item, normalizedCL);
            const subRow = el('div', { class: classNames('checklist-view-row', 'sub-level', this.getCompletedClass(item), blocked && 'blocked') });
            
            // Indent spacer
            subRow.appendChild(el('div', { class: 'inline-cl-spacer' }));
            
            // Checkbox
            const subCb = el('input', { type: 'checkbox', class: 'checklist-view-cb' });
            subCb.checked = !!item.completed;
            subCb.disabled = blocked || isArchived;
            subCb.addEventListener('click', (e) => e.stopPropagation());
            subCb.addEventListener('change', (e) => {
              e.stopPropagation();
              this.toggleChecklistItem(t, item.id, subCb.checked);
              App.handleRoute();
            });
            subRow.appendChild(subCb);
            
            // Subtask title
            const subTextEl = el('div', { class: 'checklist-view-title' });
            if (blocked) {
              const prereq = item.dependsOn === '*' ? null : normalizedCL.find(c => c.id === item.dependsOn);
              subTextEl.textContent = '🔒 ' + item.text;
              subTextEl.title = 'Waiting for: ' + (item.dependsOn === '*' ? 'All items' : (prereq ? prereq.text : 'Unknown'));
            } else {
              subTextEl.textContent = item.text;
            }
            subRow.appendChild(subTextEl);
            
            // Subtask meta
            const subMeta = el('div', { class: 'checklist-view-meta' });
            
            // Subtask Assignees
            const itemAssigneeNames = [];
            if (item.assigneeName) itemAssigneeNames.push(item.assigneeName);
            if (item.coAssignees && Array.isArray(item.coAssignees)) {
              item.coAssignees.forEach(name => {
                if (name && !itemAssigneeNames.includes(name)) itemAssigneeNames.push(name);
              });
            }
            if (itemAssigneeNames.length > 0) {
              subMeta.appendChild(this.renderAssigneeAvatarsList(itemAssigneeNames));
            }
            
            // Subtask hours
            const itemHours = getChecklistItemTotalHours(item);
            if (itemHours > 0) {
              subMeta.appendChild(el('span', { class: 'checklist-view-hours font-mono', text: itemHours + 'h' }));
            }
            
            subRow.appendChild(subMeta);
            
            // Click opens task side pane
            subRow.addEventListener('click', () => {
              this.showTaskSidePane(t.id, subRow);
            });
            
            subItemsWrap.appendChild(subRow);
          });
          
          taskCard.appendChild(subItemsWrap);
        }
        
        clContainer.appendChild(taskCard);
      });
    }
    return clContainer;
  },

  showConfirm(title, message, onConfirm, type = 'warning', onCancel = null) {
    const wrapper = el('div', { class: `modal-message-wrapper type-${type}` });

    const icon = el('div', { class: 'modal-icon-v2', html: SignalIcons[type] || SignalIcons.warning });
    wrapper.appendChild(icon);

    wrapper.appendChild(el('p', { text: message, class: 'modal-text' }));

    const footer = el('div', { class: 'modal-footer' });
    const cancelBtn = el('button', { class: 'btn modal-btn-cancel', text: 'No, cancel' });
    const confirmBtn = el('button', {
        class: `btn modal-btn-sure ${type === 'danger' ? 'btn-danger' : 'btn-primary'}`,
        text: "Yes, I'm sure"
    });

    footer.appendChild(confirmBtn);
    footer.appendChild(cancelBtn);
    wrapper.appendChild(footer);

    const overlay = this.showModal(title, wrapper, onCancel);
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      if (onCancel) onCancel();
    });
    confirmBtn.addEventListener('click', () => {
      overlay.remove();
      if (onConfirm) onConfirm();
    });
  },

  /**
   * Open a modal with the full billing/invoice creation form,
   * pre-populated from the given work request.
   */
  async openGenerateBillingModal(wr, preselectedTask) {
    const entity = Auth.activeEntity;
    const client = window.apiClient.clientCache.getById(wr.clientId);
    const tasks = WorkflowData.getTasksWhere(t => t.workRequestId === wr.id);
    const invoiceNumber = await Utils.nextInvoiceNumber(entity);

    const wrapper = el('div', { style: 'display: flex; flex-direction: column; gap: 16px;' });
    const form = el('form', { id: 'gen-billing-form', class: 'form-stacked' });

    // ---------- Client (read-only, auto-filled) ----------
    const clientGroup = el('div', { class: 'form-group' });
    clientGroup.appendChild(el('label', { text: 'Client' }));
    const clientDisplay = el('input', {
      type: 'text',
      value: client ? client.name : '—',
      readonly: true,
      style: 'background: #f1f5f9; cursor: default;'
    });
    clientGroup.appendChild(clientDisplay);
    // hidden field so FormData picks it up
    clientGroup.appendChild(el('input', { type: 'hidden', name: 'clientId', value: wr.clientId || '' }));
    form.appendChild(clientGroup);

    // ---------- Work Request (read-only, auto-filled) ----------
    const wrGroup = el('div', { class: 'form-group' });
    wrGroup.appendChild(el('label', { text: 'Work Request' }));
    const wrDisplay = el('input', {
      type: 'text',
      value: wr.title || '—',
      readonly: true,
      style: 'background: #f1f5f9; cursor: default;'
    });
    wrGroup.appendChild(wrDisplay);
    wrGroup.appendChild(el('input', { type: 'hidden', name: 'workRequestId', value: wr.id }));
    form.appendChild(wrGroup);

    // ---------- Task link (optional) ----------
    if (tasks.length > 0) {
      const taskGroup = el('div', { class: 'form-group' });
      taskGroup.appendChild(el('label', { text: 'Link to Specific Task' }));
      const taskSel = el('select', { name: 'linkedTaskId' });
      taskSel.appendChild(el('option', { value: '', text: '— Whole Project —' }));
      tasks.forEach(t => {
        const opt = el('option', { value: t.id, text: t.title });
        if (preselectedTask && preselectedTask.id === t.id) opt.selected = true;
        taskSel.appendChild(opt);
      });
      taskGroup.appendChild(taskSel);
      form.appendChild(taskGroup);
    }

    // ---------- Dates ----------
    const dateRow = el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px;' });

    const issueDateGroup = el('div', { class: 'form-group' });
    issueDateGroup.appendChild(el('label', { text: 'Issue Date *' }));
    issueDateGroup.appendChild(el('input', {
      type: 'date', name: 'issueDate',
      value: new Date().toISOString().slice(0, 10),
      required: true
    }));
    dateRow.appendChild(issueDateGroup);

    const dueDateGroup = el('div', { class: 'form-group' });
    dueDateGroup.appendChild(el('label', { text: 'Due Date *' }));
    dueDateGroup.appendChild(el('input', {
      type: 'date', name: 'dueDate',
      value: '', required: true
    }));
    dateRow.appendChild(dueDateGroup);
    form.appendChild(dateRow);

    // ---------- Invoice Number (auto-generated, read-only) ----------
    const numGroup = el('div', { class: 'form-group' });
    numGroup.appendChild(el('label', { text: 'Invoice Number' }));
    numGroup.appendChild(el('input', {
      type: 'text', name: 'invoiceNumber',
      value: invoiceNumber,
      readonly: true,
      style: 'background: #f1f5f9; cursor: default;'
    }));
    form.appendChild(numGroup);

    // ---------- Line Items ----------
    const itemsSection = el('div', { class: 'form-section', style: 'margin-top: 4px;' });
    itemsSection.appendChild(el('h4', { text: 'Line Items' }));
    const itemsList = el('div', { id: 'modal-line-item-rows' });
    itemsSection.appendChild(itemsList);

    const recalcModalTotals = () => {
      const rows = itemsList.querySelectorAll('.line-item-row');
      let subtotal = 0;
      rows.forEach(row => {
        subtotal += parseFloat(row.querySelector('.item-amt').value) || 0;
      });
      const subEl = form.querySelector('#modal-inv-subtotal');
      const totEl = form.querySelector('#modal-inv-total');
      if (subEl) subEl.textContent = formatPHP(subtotal);
      if (totEl) totEl.textContent = formatPHP(subtotal);
    };

    const addModalLineItem = (item) => {
      const row = el('div', { class: 'line-item-row' });
      const typeSel = el('select', { class: 'item-type' });
      ['Professional Fee', 'Government Fee'].forEach(t => {
        const opt = el('option', { value: t, text: t });
        if (item?.type === t) opt.selected = true;
        typeSel.appendChild(opt);
      });
      row.appendChild(typeSel);
      row.appendChild(el('input', { type: 'text', placeholder: 'Description', class: 'item-desc', value: item?.description || '' }));
      row.appendChild(el('input', { type: 'number', placeholder: 'Amount', class: 'item-amt', value: item?.amount || '', min: 0, step: 0.01 }));
      const removeBtn = el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: '×' });
      removeBtn.addEventListener('click', () => { row.remove(); recalcModalTotals(); });
      row.appendChild(removeBtn);
      itemsList.appendChild(row);
    };

    // Default line items
    addModalLineItem({ type: 'Professional Fee', description: '', amount: '' });
    addModalLineItem({ type: 'Government Fee', description: '', amount: '' });

    const addItemBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '+ Add Line Item', style: 'margin-top: 6px;' });
    addItemBtn.addEventListener('click', () => addModalLineItem());
    itemsSection.appendChild(addItemBtn);
    form.appendChild(itemsSection);

    // ---------- Totals ----------
    const totals = el('div', { style: 'display: flex; flex-direction: column; gap: 4px; align-items: flex-end; margin-top: 8px; padding: 12px; background: #f8fafc; border-radius: 12px;' });
    const subRow = el('div', { style: 'display: flex; gap: 12px; font-size: 0.85rem; color: #64748b;' });
    subRow.appendChild(el('span', { text: 'Subtotal:' }));
    subRow.appendChild(el('span', { id: 'modal-inv-subtotal', text: '₱0.00' }));
    totals.appendChild(subRow);
    const grandRow = el('div', { style: 'display: flex; gap: 12px; font-size: 1rem; font-weight: 700; color: #1e293b;' });
    grandRow.appendChild(el('span', { text: 'Total:' }));
    grandRow.appendChild(el('span', { id: 'modal-inv-total', text: '₱0.00' }));
    totals.appendChild(grandRow);
    form.appendChild(totals);

    // Live recalculation
    form.addEventListener('input', () => recalcModalTotals());

    wrapper.appendChild(form);

    // ---------- Footer buttons ----------
    const footer = el('div', { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;' });
    const cancelBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel' });
    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Save Invoice' });
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    wrapper.appendChild(footer);

    // Open modal
    const overlay = this.showModal('Generate Billing', wrapper);
    overlay.querySelector('.modal').classList.add('modal-wide');

    cancelBtn.addEventListener('click', () => overlay.remove());

    saveBtn.addEventListener('click', async () => {
      // Basic validation
      const issueDate = form.querySelector('[name="issueDate"]').value;
      const dueDate = form.querySelector('[name="dueDate"]').value;
      if (!issueDate || !dueDate) {
        this.showMessage('Validation Error', 'Please fill in both Issue Date and Due Date.', 'warning');
        return;
      }

      const data = Object.fromEntries(new FormData(form).entries());
      const rows = form.querySelectorAll('.line-item-row');
      const lineItems = [];
      let subtotal = 0;
      rows.forEach(row => {
        const amt = parseFloat(row.querySelector('.item-amt').value) || 0;
        subtotal += amt;
        lineItems.push({
          type: row.querySelector('.item-type').value,
          description: row.querySelector('.item-desc').value.trim(),
          amount: amt
        });
      });

      const record = {
        invoiceNumber: data.invoiceNumber,
        clientId: data.clientId,
        workRequestId: data.workRequestId || null,
        linkedTaskId: data.linkedTaskId || null,
        entity: entity,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        lineItems,
        subtotal,
        vat: 0,
        total: subtotal,
        status: 'Draft',
        payments: [],
        createdBy: Auth.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      try {
        const res = await window.apiClient.invoices.create(record);
        const created = res?.data || record;
        WorkflowData.invalidateRelatedForWorkRequest(created.workRequestId || data.workRequestId);
      } catch (e) {
        console.error('Failed to create invoice', e);
        this.showMessage('Error', 'Failed to create invoice: ' + (e.message || 'Unknown error'), 'danger');
        return;
      }

      overlay.remove();

      this.showMessage(
        'Invoice Created',
        'Invoice ' + record.invoiceNumber + ' has been created successfully and linked to "' + wr.title + '".',
        'success'
      );

      // Refresh WR detail
      App.handleRoute();
    });
  },

  /**
   * Open a modal with the disbursement/expense creation form,
   * pre-populated from the given work request.
   */
  async openGenerateDisbursementModal(wr, preselectedTask) {
    const entity = Auth.activeEntity;
    const client = window.apiClient.clientCache.getById(wr.clientId);
    const tasks = WorkflowData.getTasksWhere(t => t.workRequestId === wr.id);
    let availableInvoices = [];
    try {
      const invRes = await window.apiClient.invoices.list({ workRequestId: wr.id, status: '!Cancelled' });
      availableInvoices = invRes?.data || [];
    } catch (e) {
      console.error('[Workflow] failed to load invoices for disbursement modal', e);
    }

    const wrapper = el('div', { style: 'display: flex; flex-direction: column; gap: 16px;' });
    const form = el('form', { id: 'gen-disbursement-form', class: 'form-stacked' });

    // ---------- Client (read-only, auto-filled) ----------
    const clientGroup = el('div', { class: 'form-group' });
    clientGroup.appendChild(el('label', { text: 'Client' }));
    clientGroup.appendChild(el('input', {
      type: 'text',
      value: client ? client.name : '—',
      readonly: true,
      style: 'background: #f1f5f9; cursor: default;'
    }));
    form.appendChild(clientGroup);

    // ---------- Work Request (read-only, auto-filled) ----------
    const wrGroup = el('div', { class: 'form-group' });
    wrGroup.appendChild(el('label', { text: 'Work Request' }));
    wrGroup.appendChild(el('input', {
      type: 'text',
      value: wr.title || '—',
      readonly: true,
      style: 'background: #f1f5f9; cursor: default;'
    }));
    wrGroup.appendChild(el('input', { type: 'hidden', name: 'linkedWorkRequestId', value: wr.id }));
    form.appendChild(wrGroup);

    // ---------- Task link (optional) ----------
    if (tasks.length > 0) {
      const taskGroup = el('div', { class: 'form-group' });
      taskGroup.appendChild(el('label', { text: 'Link to Specific Task' }));
      const taskSel = el('select', { name: 'linkedTaskId' });
      taskSel.appendChild(el('option', { value: '', text: '— Whole Project —' }));
      tasks.forEach(t => {
        const opt = el('option', { value: t.id, text: t.title });
        if (preselectedTask && preselectedTask.id === t.id) opt.selected = true;
        taskSel.appendChild(opt);
      });
      taskGroup.appendChild(taskSel);
      form.appendChild(taskGroup);
    }

    // ---------- Category ----------
    const catGroup = el('div', { class: 'form-group' });
    catGroup.appendChild(el('label', { text: 'Category *' }));
    const catSel = el('select', { name: 'category', required: true, class: 'form-select' });
    ['Transportation', 'Notary', 'Meals', 'Government Fee', 'Other'].forEach(c => {
      catSel.appendChild(el('option', { value: c, text: c }));
    });
    catGroup.appendChild(catSel);
    form.appendChild(catGroup);

    // ---------- Description ----------
    const descGroup = el('div', { class: 'form-group' });
    descGroup.appendChild(el('label', { text: 'Description *' }));
    descGroup.appendChild(el('input', { type: 'text', name: 'description', required: true, placeholder: 'e.g. BIR filing fee' }));
    form.appendChild(descGroup);

    // ---------- Amount ----------
    const amtGroup = el('div', { class: 'form-group' });
    amtGroup.appendChild(el('label', { text: 'Amount (₱) *' }));
    const amtIn = el('input', { type: 'text', inputmode: 'decimal', name: 'amount', placeholder: '0.00', required: true });
    amtIn.addEventListener('input', () => { amtIn.value = amtIn.value.replace(/[^0-9.,]/g, ''); });
    amtIn.addEventListener('focus', () => { const n = parseFloat(String(amtIn.value).replace(/[₱$,\s]/g, '')) || 0; amtIn.value = n > 0 ? String(n) : ''; });
    amtIn.addEventListener('blur', () => { const n = parseFloat(String(amtIn.value).replace(/[₱$,\s]/g, '')) || 0; amtIn.value = n > 0 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; });
    amtGroup.appendChild(amtIn);
    form.appendChild(amtGroup);

    // ---------- Fund Source ----------
    const fundGroup = el('div', { class: 'form-group' });
    fundGroup.appendChild(el('label', { text: 'Fund Source *' }));
    const fundWrap = el('div', { class: 'radio-group' });
    ['Firm Fund', 'Client Fund'].forEach(f => {
      const label = el('label', { class: 'radio-label' });
      const radio = el('input', { type: 'radio', name: 'fundSource', value: f, required: true });
      if (f === 'Firm Fund') radio.checked = true;
      label.appendChild(radio);
      label.appendChild(document.createTextNode(' ' + f));
      fundWrap.appendChild(label);
    });
    fundGroup.appendChild(fundWrap);
    form.appendChild(fundGroup);

    // ---------- Linked Invoice (visible only for Client Fund) ----------
    const invGroup = el('div', { class: 'form-group hidden', id: 'modal-linked-invoice-group' });
    invGroup.appendChild(el('label', { text: 'Linked Billing Invoice' }));
    const invSel = el('select', { name: 'linkedInvoiceId', class: 'form-select' });
    invSel.appendChild(el('option', { value: '', text: '— Select Invoice —' }));
    availableInvoices.forEach(inv => {
      const invClient = window.apiClient.clientCache.getById(inv.clientId);
      invSel.appendChild(el('option', { value: inv.id, text: inv.invoiceNumber + ' — ' + (invClient?.name || '—') }));
    });
    invGroup.appendChild(invSel);
    form.appendChild(invGroup);

    // Toggle linked invoice visibility
    form.querySelectorAll('input[name="fundSource"]').forEach(r => {
      r.addEventListener('change', () => {
        const isClient = form.querySelector('input[name="fundSource"]:checked')?.value === 'Client Fund';
        invGroup.classList.toggle('hidden', !isClient);
      });
    });

    // ---------- Receipt (optional) ----------
    const receiptGroup = el('div', { class: 'form-group' });
    receiptGroup.appendChild(el('label', { text: 'Receipt (optional)' }));
    receiptGroup.appendChild(el('input', { type: 'file', name: 'receipt' }));
    form.appendChild(receiptGroup);

    wrapper.appendChild(form);

    // ---------- Footer buttons ----------
    const footer = el('div', { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;' });
    const cancelBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel' });
    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Submit Expense' });
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    wrapper.appendChild(footer);

    // Open modal
    const overlay = this.showModal('Generate Disbursement', wrapper);

    cancelBtn.addEventListener('click', () => overlay.remove());

    saveBtn.addEventListener('click', async () => {
      // Validation
      const desc = form.querySelector('[name="description"]').value.trim();
      const amtVal = form.querySelector('[name="amount"]').value;
      if (!desc) {
        this.showMessage('Validation Error', 'Please enter a description.', 'warning');
        return;
      }
      const amount = parseFloat(String(amtVal).replace(/[₱$,\s]/g, '')) || 0;
      if (amount <= 0) {
        this.showMessage('Validation Error', 'Please enter a valid amount.', 'warning');
        return;
      }

      const data = Object.fromEntries(new FormData(form).entries());
      const receiptInput = form.querySelector('input[name="receipt"]');
      const receiptFile = receiptInput?.files?.[0];

      const record = {
        category: data.category,
        description: desc,
        amount: amount,
        fundSource: data.fundSource,
        linkedInvoiceId: data.linkedInvoiceId || null,
        linkedWorkRequestId: data.linkedWorkRequestId || null,
        linkedTaskId: data.linkedTaskId || null,
        entity: entity,
        employeeId: Auth.user.id,
        requestedBy: Auth.user.id,
        status: 'Submitted',
        submittedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        receiptFilename: receiptFile ? receiptFile.name : null
      };

      try {
        const res = await window.apiClient.disbursements.create(record);
        const created = res?.data || record;
        WorkflowData.invalidateRelatedForWorkRequest(created.linkedWorkRequestId || data.linkedWorkRequestId);
      } catch (e) {
        console.error('Failed to create disbursement', e);
        this.showMessage('Error', 'Failed to create disbursement: ' + (e.message || 'Unknown error'), 'danger');
        return;
      }

      overlay.remove();

      this.showMessage(
        'Expense Filed',
        'Disbursement for ' + data.category + ' (₱' + amount.toLocaleString('en-US', { minimumFractionDigits: 2 }) + ') has been submitted and linked to "' + wr.title + '".',
        'success'
      );

      // Refresh WR detail
      App.handleRoute();
    });
  },

  /**
   * Open a modal with the transmittal creation form,
   * pre-populated from the given work request.
   */
  async openGenerateTransmittalModal(wr, preselectedTask = null, prefilledRequestId = null) {
    const entity = Auth.activeEntity;
    const client = window.apiClient.clientCache.getById(wr.clientId);

    let opReq = null;
    try {
      if (prefilledRequestId) {
        const res = await window.apiClient.operationsRequests.get(prefilledRequestId);
        opReq = res?.data || null;
      } else {
        const res = await window.apiClient.operationsRequests.list({ workRequestId: wr.id, type: 'transmittal', status: 'pending' });
        opReq = (res?.data || [])[0] || null;
      }
    } catch (e) {
      console.error('[Workflow] failed to load operations request for transmittal modal', e);
    }

    const wrapper = el('div', { style: 'display: flex; flex-direction: column; gap: 16px;' });
    const form = el('form', { id: 'gen-transmittal-form', class: 'form-stacked' });

    // ---------- Client (read-only, auto-filled) ----------
    const clientGroup = el('div', { class: 'form-group' });
    clientGroup.appendChild(el('label', { text: 'Client' }));
    clientGroup.appendChild(el('input', {
      type: 'text',
      value: client ? client.name : '—',
      readonly: true,
      style: 'background: #f1f5f9; cursor: default;'
    }));
    clientGroup.appendChild(el('input', { type: 'hidden', name: 'clientId', value: wr.clientId || '' }));
    form.appendChild(clientGroup);

    // ---------- Work Request (read-only, auto-filled) ----------
    const wrGroup = el('div', { class: 'form-group' });
    wrGroup.appendChild(el('label', { text: 'Work Request' }));
    wrGroup.appendChild(el('input', {
      type: 'text',
      value: wr.title || '—',
      readonly: true,
      style: 'background: #f1f5f9; cursor: default;'
    }));
    wrGroup.appendChild(el('input', { type: 'hidden', name: 'workRequestId', value: wr.id }));
    form.appendChild(wrGroup);

    // ---------- Tracking Number (auto-generated, read-only) ----------
    const tnGroup = el('div', { class: 'form-group' });
    tnGroup.appendChild(el('label', { text: 'Tracking Number' }));
    tnGroup.appendChild(el('input', {
      type: 'text', name: 'trackingNumber',
      value: Utils.generateTrackingNumber(entity),
      readonly: true,
      style: 'background: #f1f5f9; cursor: default;'
    }));
    form.appendChild(tnGroup);

    // ---------- Itemized Document List ----------
    const itemsSection = el('div', { class: 'form-section', style: 'margin-top: 4px;' });
    itemsSection.appendChild(el('h4', { text: 'Document Items' }));

    // Column headers
    const headerLabelStyle = 'font-size: 0.75rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em; padding-left: 13px;';
    const colHeaders = el('div', { class: 'line-item-row', style: 'margin-bottom: 4px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;' });
    colHeaders.appendChild(el('span', { text: 'Document Type', class: 'item-type', style: headerLabelStyle }));
    colHeaders.appendChild(el('span', { text: 'Description', class: 'item-desc', style: headerLabelStyle }));
    colHeaders.appendChild(el('span', { class: 'btn btn-sm', style: 'visibility: hidden;', text: '×' }));
    itemsSection.appendChild(colHeaders);

    const itemsList = el('div', { id: 'modal-transmittal-item-rows' });
    itemsSection.appendChild(itemsList);

    const addTransmittalItem = (item) => {
      const row = el('div', { class: 'line-item-row' });

      const typeSel = el('select', { class: 'item-type' });
      ['Original Scan', 'Generated Copy', 'Government Receipt', 'Final Deliverable', 'Other'].forEach(t => {
        const opt = el('option', { value: t, text: t });
        if (item?.documentType === t) opt.selected = true;
        typeSel.appendChild(opt);
      });
      row.appendChild(typeSel);

      row.appendChild(el('input', { type: 'text', placeholder: 'Description', class: 'item-desc', value: item?.description || '' }));

      const removeBtn = el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: '×' });
      removeBtn.addEventListener('click', () => {
        if (itemsList.querySelectorAll('.line-item-row').length > 1) {
          row.remove();
        }
      });
      row.appendChild(removeBtn);

      itemsList.appendChild(row);
    };

    // opReq was loaded from the API above.

    // Default items
    if (opReq && Array.isArray(opReq.documents) && opReq.documents.length > 0) {
      opReq.documents.forEach(docName => {
        addTransmittalItem({ documentType: 'Generated Copy', description: docName });
      });
    } else {
      addTransmittalItem();
    }

    const addItemBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '+ Add Item', style: 'margin-top: 6px;' });
    addItemBtn.addEventListener('click', () => addTransmittalItem());
    itemsSection.appendChild(addItemBtn);
    form.appendChild(itemsSection);

    // ---------- Notes ----------
    const notesGroup = el('div', { class: 'form-group' });
    notesGroup.appendChild(el('label', { text: 'Notes' }));
    const notesTextarea = el('textarea', { name: 'notes', rows: 3, placeholder: 'Optional notes for the recipient...' });
    if (opReq) {
      notesTextarea.value = `Recipient: ${opReq.recipientDetails || ''}\nNotes: ${opReq.notes || ''}`;
    }
    notesGroup.appendChild(notesTextarea);
    form.appendChild(notesGroup);

    wrapper.appendChild(form);

    // ---------- Footer buttons ----------
    const footer = el('div', { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;' });
    const cancelBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel' });
    const saveBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Create Transmittal' });
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    wrapper.appendChild(footer);

    // Open modal
    const overlay = this.showModal('Generate Transmittal', wrapper);
    overlay.querySelector('.modal').classList.add('modal-wide');

    cancelBtn.addEventListener('click', () => overlay.remove());

    saveBtn.addEventListener('click', async () => {
      // Collect items
      const rows = itemsList.querySelectorAll('.line-item-row');
      const items = [];
      rows.forEach(row => {
        const desc = row.querySelector('.item-desc')?.value?.trim();
        const docType = row.querySelector('.item-type')?.value;
        if (desc && docType) {
          items.push({ description: desc, documentType: docType });
        }
      });

      if (items.length === 0) {
        this.showMessage('Validation Error', 'Please add at least one document item with a description.', 'warning');
        return;
      }

      const data = Object.fromEntries(new FormData(form).entries());

      const record = {
        workRequestId: data.workRequestId,
        clientId: data.clientId,
        trackingNumber: data.trackingNumber || Utils.generateTrackingNumber(entity),
        status: 'Draft',
        items,
        notes: data.notes || '',
        entity,
        createdAt: new Date().toISOString(),
        createdBy: Auth.user.id
      };

      let createdTransmittal;
      try {
        const res = await window.apiClient.transmittals.create(record);
        createdTransmittal = res?.data || record;
      } catch (e) {
        console.error('Failed to create transmittal', e);
        this.showMessage('Error', 'Failed to create transmittal: ' + (e.message || 'Unknown error'), 'danger');
        return;
      }

      // Fulfill pending operations request if any
      const reqId = prefilledRequestId || (opReq ? opReq.id : null);
      if (reqId) {
        try {
          await window.apiClient.operationsRequests.update(reqId, {
            status: 'fulfilled',
            fulfilledBy: Auth.user.id,
            fulfilledAt: new Date().toISOString(),
            linkedRecordId: createdTransmittal.id
          });
        } catch (e) {
          console.error('Failed to fulfill operations request', e);
        }
      }

      WorkflowData.invalidateRelatedForWorkRequest(data.workRequestId);

      overlay.remove();

      this.showMessage(
        'Transmittal Created',
        'Transmittal ' + record.trackingNumber + ' has been created and linked to "' + wr.title + '".',
        'success'
      );

      // Refresh WR detail
      App.handleRoute();
    });
  },

  getFinancialQuickActions(wr, t) {
    const actions = [];
    FINANCIAL_ACTION_CONFIGS.forEach(cfg => {
      let title = null;
      let handler = null;
      if (Auth.can(cfg.createPerm)) {
        title = cfg.createTitle;
        handler = async () => cfg.createHandler(this, wr, t);
      } else if (Auth.can(cfg.requestPerm)) {
        title = cfg.requestTitle;
        handler = async () => this.submitOperationsRequest(cfg.type, wr, t);
      }

      if (title && handler) {
        actions.push({
          type: cfg.type,
          title,
          menuIconHtml: cfg.icon,
          toolbarIconHtml: makeToolbarIcon(cfg.icon),
          handler
        });
      }
    });
    return actions;
  },

  async submitOperationsRequest(type, wr, preselectedTask = null) {
    let existing = [];
    let rejectedReqs = [];
    let dmsDocs = [];
    try {
      const existingRes = await window.apiClient.operationsRequests.list({ workRequestId: wr.id, type, status: 'pending' });
      existing = existingRes?.data || [];
    } catch (e) {
      console.error('[Workflow] failed to load pending operations requests', e);
    }
    if (existing.length > 0) {
      this.showMessage('Already Requested', 'A request for this action is already pending review.', 'info');
      return;
    }
    try {
      const rejectedRes = await window.apiClient.operationsRequests.list({ workRequestId: wr.id, type, status: 'rejected' });
      rejectedReqs = rejectedRes?.data || [];
    } catch (e) {
      console.error('[Workflow] failed to load rejected operations requests', e);
    }
    if (type === 'transmittal') {
      try {
        const docsRes = await window.apiClient.documents.list({ workRequestId: wr.id });
        dmsDocs = docsRes?.data || [];
      } catch (e) {
        console.error('[Workflow] failed to load DMS documents for operations request', e);
      }
    }

    const wrapper = el('div', { style: 'display: flex; flex-direction: column; gap: var(--spacing-md); min-width: 420px; max-width: 500px;' });
    const form = el('form', { class: 'form-stacked' });

    const client = window.apiClient.clientCache.getById(wr.clientId);
    const contextRow = el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-sm); border-bottom: 1px solid var(--color-border); padding-bottom: var(--spacing-sm); margin-bottom: var(--spacing-xs);' }, [
      el('div', { class: 'form-group' }, [
        el('label', { text: 'Client' }),
        el('span', { text: client ? client.name : '—', style: 'font-weight: 500; font-size: 0.875rem;' })
      ]),
      el('div', { class: 'form-group' }, [
        el('label', { text: 'Work Request' }),
        el('span', { text: wr.title || '—', style: 'font-weight: 500; font-size: 0.875rem;' })
      ])
    ]);
    form.appendChild(contextRow);

    const rejectedReq = rejectedReqs.sort((a,b) => new Date(b.requestedAt) - new Date(a.requestedAt))[0];
    if (rejectedReq && rejectedReq.rejectionReason) {
      const rejectNote = el('div', { 
        style: 'background: #fef2f2; border: 1px solid #fecaca; border-radius: var(--radius-sm); padding: var(--spacing-sm); margin-bottom: var(--spacing-xs); font-size: 0.8125rem; color: #b91c1c;' 
      }, [
        el('strong', { text: 'Previous Request Rejected: ' }),
        el('span', { text: `"${rejectedReq.rejectionReason}"` })
      ]);
      form.appendChild(rejectNote);
    }

    if (type === 'billing') {
      // 1. Link to Specific Task
      const tasks = WorkflowData.getTasksWhere(t => t.workRequestId === wr.id) || [];
      const taskGroup = el('div', { class: 'form-group' });
      taskGroup.appendChild(el('label', { text: 'Link to Specific Task' }));
      const taskSel = el('select', { name: 'linkedTaskId', class: 'form-select' });
      taskSel.appendChild(el('option', { value: '', text: '— Whole Project —' }));
      tasks.forEach(t => {
        const opt = el('option', { value: t.id, text: t.title });
        if (preselectedTask && preselectedTask.id === t.id) opt.selected = true;
        taskSel.appendChild(opt);
      });
      taskGroup.appendChild(taskSel);
      form.appendChild(taskGroup);

      // 2. Billing Amount
      const amtGroup = el('div', { class: 'form-group' });
      amtGroup.appendChild(el('label', { text: 'Billing Amount (₱) *' }));
      const amtIn = el('input', { type: 'text', inputmode: 'decimal', name: 'amount', placeholder: '0.00', required: true });
      amtIn.addEventListener('input', () => { amtIn.value = amtIn.value.replace(/[^0-9.,]/g, ''); });
      amtIn.addEventListener('focus', () => { const n = parseFloat(String(amtIn.value).replace(/[₱$,\s]/g, '')) || 0; amtIn.value = n > 0 ? String(n) : ''; });
      amtIn.addEventListener('blur', () => { const n = parseFloat(String(amtIn.value).replace(/[₱$,\s]/g, '')) || 0; amtIn.value = n > 0 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; });
      amtGroup.appendChild(amtIn);
      form.appendChild(amtGroup);

      // 3. Attachment / Proof
      const fileGroup = el('div', { class: 'form-group' });
      fileGroup.appendChild(el('label', { text: 'Proof of Completion (optional)' }));
      const fileIn = el('input', { type: 'file', name: 'receipt' });
      fileGroup.appendChild(fileIn);
      form.appendChild(fileGroup);

      // 4. Notes
      const notesGroup = el('div', { class: 'form-group' });
      notesGroup.appendChild(el('label', { text: 'Billing Notes (Optional)' }));
      const notesArea = el('textarea', { name: 'notes', class: 'form-control', style: 'min-height: 80px;', placeholder: 'e.g. Requesting milestone Downpayment billing...' });
      notesGroup.appendChild(notesArea);
      form.appendChild(notesGroup);
    }
    else if (type === 'disbursement') {
      // 1. Request Type Toggle (Reimbursement vs Cash Advance)
      const typeGroup = el('div', { class: 'form-group' });
      typeGroup.appendChild(el('label', { text: 'Disbursement Type *' }));
      const typeWrap = el('div', { class: 'radio-group', style: 'display: flex; gap: var(--spacing-md);' });
      
      const rLabel = el('label', { class: 'radio-label', style: 'font-weight: normal; cursor: pointer;' });
      const rRadio = el('input', { type: 'radio', name: 'disbursementType', value: 'reimbursement', checked: true });
      rLabel.appendChild(rRadio);
      rLabel.appendChild(document.createTextNode(' Reimbursement (Already Spent)'));
      
      const caLabel = el('label', { class: 'radio-label', style: 'font-weight: normal; cursor: pointer;' });
      const caRadio = el('input', { type: 'radio', name: 'disbursementType', value: 'cash_advance' });
      caLabel.appendChild(caRadio);
      caLabel.appendChild(document.createTextNode(' Cash Advance (Needed in Advance)'));
      
      typeWrap.appendChild(rLabel);
      typeWrap.appendChild(caLabel);
      typeGroup.appendChild(typeWrap);
      form.appendChild(typeGroup);

      // 2. Category Select
      const catGroup = el('div', { class: 'form-group' });
      catGroup.appendChild(el('label', { text: 'Category *' }));
      const catSel = el('select', { name: 'category', required: true, class: 'form-select' });
      ['Government Fee', 'Notarization', 'Transportation / Travel', 'Meals / Client Meeting', 'Other'].forEach(c => {
        catSel.appendChild(el('option', { value: c, text: c }));
      });
      catGroup.appendChild(catSel);
      form.appendChild(catGroup);

      // 3. Amount
      const amtGroup = el('div', { class: 'form-group' });
      amtGroup.appendChild(el('label', { text: 'Amount (₱) *' }));
      const amtIn = el('input', { type: 'text', inputmode: 'decimal', name: 'amount', placeholder: '0.00', required: true });
      amtIn.addEventListener('input', () => { amtIn.value = amtIn.value.replace(/[^0-9.,]/g, ''); });
      amtIn.addEventListener('focus', () => { const n = parseFloat(String(amtIn.value).replace(/[₱$,\s]/g, '')) || 0; amtIn.value = n > 0 ? String(n) : ''; });
      amtIn.addEventListener('blur', () => { const n = parseFloat(String(amtIn.value).replace(/[₱$,\s]/g, '')) || 0; amtIn.value = n > 0 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; });
      amtGroup.appendChild(amtIn);
      form.appendChild(amtGroup);

      // 4. Payment Method
      const payGroup = el('div', { class: 'form-group' });
      payGroup.appendChild(el('label', { text: 'Preferred Payment Method *' }));
      const paySel = el('select', { name: 'paymentMethod', class: 'form-select', required: true });
      ['Cash', 'Bank Transfer', 'GCash / E-Wallet', 'Check'].forEach(m => {
        paySel.appendChild(el('option', { value: m, text: m }));
      });
      payGroup.appendChild(paySel);
      form.appendChild(payGroup);

      // 5. File upload for Receipt/Assessment
      const fileGroup = el('div', { class: 'form-group' });
      const fileLabel = el('label', { text: 'Receipt (Recommended)' });
      fileGroup.appendChild(fileLabel);
      const fileIn = el('input', { type: 'file', name: 'receipt' });
      fileGroup.appendChild(fileIn);
      form.appendChild(fileGroup);

      // Toggle receipt label based on Reimbursement vs Cash Advance
      rRadio.addEventListener('change', () => { fileLabel.textContent = 'Receipt (Recommended)'; });
      caRadio.addEventListener('change', () => { fileLabel.textContent = 'Assessment Statement / Quote (optional)'; });

      // 6. Notes
      const notesGroup = el('div', { class: 'form-group' });
      notesGroup.appendChild(el('label', { text: 'Disbursement Notes (Optional)' }));
      const notesArea = el('textarea', { name: 'notes', class: 'form-control', style: 'min-height: 80px;', placeholder: 'e.g. Bank details or specific breakdown details...' });
      notesGroup.appendChild(notesArea);
      form.appendChild(notesGroup);
    }
    else if (type === 'transmittal') {
      // 1. Documents listing (Hybrid)
      const docGroup = el('div', { class: 'form-group' });
      docGroup.appendChild(el('label', { text: 'Documents to Transmit *', style: 'margin-bottom: var(--spacing-xs);' }));
      
      const docListContainer = el('div', { style: 'display: flex; flex-direction: column; gap: var(--spacing-xs); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--spacing-sm); max-height: 150px; overflow-y: auto; background: var(--color-surface);' });
      
      // Load DMS documents (already loaded from API above)
      if (dmsDocs.length === 0) {
        docListContainer.appendChild(el('span', { text: 'No uploaded DMS documents found.', style: 'font-size: 0.75rem; color: var(--color-text-muted); font-style: italic;' }));
      } else {
        dmsDocs.forEach(doc => {
          const row = el('label', { style: 'display: flex; align-items: center; gap: var(--spacing-sm); font-size: 0.8125rem; font-weight: normal; cursor: pointer; margin-bottom: 0;' });
          const chk = el('input', { type: 'checkbox', class: 'dms-doc-checkbox', value: doc.fileName });
          row.appendChild(chk);
          row.appendChild(document.createTextNode(' ' + doc.fileName + (doc.documentType ? ` (${doc.documentType})` : '')));
          docListContainer.appendChild(row);
        });
      }
      docGroup.appendChild(docListContainer);
      form.appendChild(docGroup);

      // 2. Add manual documents text
      const manualGroup = el('div', { class: 'form-group' });
      manualGroup.appendChild(el('label', { text: 'Additional / Physical Items to Transmit' }));
      const manualIn = el('input', { type: 'text', name: 'manualDocs', placeholder: 'e.g. Original Barangay Clearance, Official Receipt (comma separated)...', class: 'form-control' });
      manualGroup.appendChild(manualIn);
      form.appendChild(manualGroup);

      // 3. Recipient & Delivery Details
      const recGroup = el('div', { class: 'form-group' });
      recGroup.appendChild(el('label', { text: 'Recipient & Delivery Details *' }));
      const recArea = el('textarea', { name: 'recipientDetails', class: 'form-control', required: true, style: 'min-height: 80px;', placeholder: 'Recipient Name, Phone, and Delivery Address...' });
      recGroup.appendChild(recArea);
      form.appendChild(recGroup);

      // 4. Additional Notes
      const notesGroup = el('div', { class: 'form-group' });
      notesGroup.appendChild(el('label', { text: 'Additional Delivery Notes (Optional)' }));
      const notesArea = el('textarea', { name: 'notes', class: 'form-control', style: 'min-height: 60px;', placeholder: 'e.g. Rush delivery, call before arrival...' });
      notesGroup.appendChild(notesArea);
      form.appendChild(notesGroup);
    }

    // Footer actions
    const footer = el('div', { style: 'display: flex; justify-content: flex-end; gap: 8px; margin-top: var(--spacing-md); border-top: 1px solid var(--color-border); padding-top: var(--spacing-sm);' }, [
      el('button', { id: 'btn-cancel-opreq', class: 'btn btn-ghost', type: 'button', text: 'Cancel' }),
      el('button', { id: 'btn-save-opreq', class: 'btn btn-primary', type: 'submit', text: 'Submit Request' })
    ]);
    form.appendChild(footer);
    wrapper.appendChild(form);

    const label = type === 'billing' ? 'Billing' : type === 'disbursement' ? 'Disbursement' : 'Transmittal';
    const overlay = this.showModal(`Submit Request for ${label}`, wrapper);

    overlay.querySelector('#btn-cancel-opreq').addEventListener('click', () => overlay.remove());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const record = {
        type,
        workRequestId: wr.id,
        clientId: wr.clientId,
        requestedBy: Auth.user.id,
        requestedAt: new Date().toISOString(),
        status: 'pending',
        rejectionReason: ''
      };

      if (type === 'billing') {
        const linkedTaskId = form.querySelector('[name="linkedTaskId"]').value;
        const amtStr = form.querySelector('[name="amount"]').value;
        const amount = parseFloat(amtStr.replace(/[₱$,\s]/g, '')) || 0;
        if (amount <= 0) {
          this.showMessage('Validation Error', 'Please enter a valid billing amount.', 'warning');
          return;
        }
        const notes = form.querySelector('[name="notes"]').value.trim();
        const receiptInput = form.querySelector('input[name="receipt"]');
        const receiptFile = receiptInput?.files?.[0];

        record.linkedTaskId = linkedTaskId || '';
        record.amount = amount;
        record.notes = notes;
        record.receiptFilename = receiptFile ? receiptFile.name : null;
      }
      else if (type === 'disbursement') {
        const disType = form.querySelector('input[name="disbursementType"]:checked').value;
        const category = form.querySelector('[name="category"]').value;
        const amtStr = form.querySelector('[name="amount"]').value;
        const amount = parseFloat(amtStr.replace(/[₱$,\s]/g, '')) || 0;
        if (amount <= 0) {
          this.showMessage('Validation Error', 'Please enter a valid disbursement amount.', 'warning');
          return;
        }
        const payMethod = form.querySelector('[name="paymentMethod"]').value;
        const notes = form.querySelector('[name="notes"]').value.trim();
        const receiptInput = form.querySelector('input[name="receipt"]');
        const receiptFile = receiptInput?.files?.[0];

        record.disbursementType = disType;
        record.category = category;
        record.amount = amount;
        record.paymentMethod = payMethod;
        record.notes = notes;
        record.receiptFilename = receiptFile ? receiptFile.name : null;
        record.linkedTaskId = preselectedTask ? preselectedTask.id : '';
      }
      else if (type === 'transmittal') {
        const checkedDocs = Array.from(form.querySelectorAll('.dms-doc-checkbox:checked')).map(chk => chk.value);
        const manualDocsStr = form.querySelector('[name="manualDocs"]').value.trim();
        const manualDocs = manualDocsStr ? manualDocsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
        const documents = [...checkedDocs, ...manualDocs];

        if (documents.length === 0) {
          this.showMessage('Validation Error', 'Please select or enter at least one document to transmit.', 'warning');
          return;
        }

        const recipientDetails = form.querySelector('[name="recipientDetails"]').value.trim();
        if (!recipientDetails) {
          this.showMessage('Validation Error', 'Please enter recipient and delivery details.', 'warning');
          return;
        }
        const notes = form.querySelector('[name="notes"]').value.trim();

        record.documents = documents;
        record.recipientDetails = recipientDetails;
        record.notes = notes;
      }

      try {
        await window.apiClient.operationsRequests.create(record);
      } catch (e) {
        console.error('Failed to create operations request', e);
        this.showMessage('Error', 'Failed to submit request: ' + (e.message || 'Unknown error'), 'danger');
        return;
      }
      overlay.remove();

      this.showMessage(
        'Request Submitted',
        `Your request for ${label} has been submitted to Accounting/Documentation for review.`,
        'success'
      );

      App.handleRoute();
    });
  },

  async render() {
    await Promise.all([
      WorkflowData.ensure(),
      this._loadRetainerTemplates(),
      this._loadGroundWorkers(),
    ]);
    await WorkflowData.loadPendingApprovals();
    const container = el('div', { class: 'page' });
    if (this.view === 'list') {
      container.classList.add('operations-list-page');
    }
    this._tempTaskMap = buildTaskMap();

    if (this.view === 'detail' && this.detailWrId) {
      let wr = WorkflowData.getWorkRequestById(this.detailWrId);
      if (!wr) {
        const pc = WorkflowData.getPendingApprovalByRecordId(this.detailWrId, 'workRequests');
        if (pc && pc.table === 'workRequests') {
          wr = { ...pc.proposedData };
          wr.id = pc.proposedData.id || pc.id;
          wr.isPendingApproval = true;
          wr.pendingChangeId = pc.id;
          wr.submittedBy = pc.submittedBy;
          wr.status = 'Draft';
        }
      }
      if (!wr || !Auth.canViewWr(wr)) {
        this.view = 'list';
        this.detailWrId = null;
        location.hash = '#operations';
        return el('div');
      }
      // Breadcrumb title bar consistent with the rest of the system
      const client = window.apiClient.clientCache.getById(wr.clientId);
      const canEdit = Auth.can('workflow:edit') && !wr.isPendingApproval;
      const isArchived = wr && wr.status === 'Cancelled';

      // Preload related records so badge/render helpers use the API-backed cache
      // instead of scanning the local DB on every render.
      await WorkflowData.loadRelatedForWorkRequest(wr.id);
      if (wr.tasks) {
        await Promise.all(wr.tasks.map(t => WorkflowData.loadRelatedForTask(t.id)));
      }

      const titleBar = el('div', { class: 'page-title-bar-v2' });
      const h1 = el('h1', { class: 'breadcrumb-h1' });
      const opLink = el('a', { href: 'javascript:void(0)', class: 'breadcrumb-base', text: 'Operations' });
      opLink.addEventListener('click', () => { location.hash = '#operations'; });
      h1.appendChild(opLink);
      h1.appendChild(el('span', { class: 'breadcrumb-sep', text: ' / ' }));
      h1.appendChild(document.createTextNode(wr.title || 'Untitled Work Request'));
      titleBar.appendChild(h1);
      const actions = el('div', { class: 'title-bar-actions' });
      const badges = el('div', { class: 'identity-badges', style: 'margin-right:12px;' });
      const statusBadgeClass = {
        'Draft': 'badge-info',
        'Pre-processing': 'badge-info',
        'Processing': 'badge-warn',
        'Billing': 'badge-warn',
        'Disbursement': 'badge-warn',
        'Completed': 'badge-success',
        'Cancelled': 'badge-danger'
      }[wr.status] || 'badge-info';
      if (wr.isPendingApproval) {
        badges.appendChild(el('span', { class: 'badge badge-warn', text: 'Awaiting Approval' }));
      } else {
        badges.appendChild(el('span', { class: `badge ${statusBadgeClass}`, text: wr.status }));
      }

      if (wr?.priority && wr.priority !== 'Normal') {
        const priorityClass = { 'Urgent': 'badge-danger', 'Priority': 'badge-warn', 'Low Priority': 'badge-info' }[wr.priority] || 'badge-muted';
        badges.appendChild(el('span', { class: `badge ${priorityClass}`, text: wr.priority }));
      }

      const finBadge = this.getFinanceBadgeForWr(wr);
      const docBadge = this.getDocBadgeForWr(wr);
      if (finBadge) badges.appendChild(finBadge);
      if (docBadge) badges.appendChild(docBadge);
      actions.appendChild(badges);

      if (wr.isPendingApproval && (Auth.user.id === wr.submittedBy || Auth.isManagerial())) {
        const cancelBtn = el('button', {
          class: 'btn btn-danger btn-sm',
          html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Cancel Request',
          style: 'margin-right: 8px;'
        });
        cancelBtn.addEventListener('click', () => {
          Workflow.showConfirm('Confirm Cancellation', 'Are you sure you want to cancel and withdraw this request?', () => {
            PendingChanges.delete(wr.pendingChangeId);
            this.view = 'list';
            this.detailWrId = null;
            App.handleRoute();
          }, 'danger');
        });
        actions.appendChild(cancelBtn);
      }
      const backBtn = el('button', { class: 'btn btn-secondary btn-sm', text: '← Back to Work Requests' });
      backBtn.addEventListener('click', () => { location.hash = '#operations'; });
      actions.appendChild(backBtn);
      titleBar.appendChild(actions);
      container.appendChild(titleBar);

      // Sub-header with WR id and client name
      const subHeader = el('div', { class: 'detail-sub-header-v2' });
      subHeader.appendChild(el('div', { class: 'detail-info-item' }, [
        el('span', { class: 'detail-info-label', text: 'Work Request' }),
        el('span', { class: 'detail-info-value font-mono', text: (wr.id || '').toString().toUpperCase() })
      ]));
      subHeader.appendChild(el('div', { class: 'detail-info-item' }, [
        el('span', { class: 'detail-info-label', text: 'Client' }),
        el('span', { class: 'detail-info-value', text: client?.name || 'Unknown Client' })
      ]));
      container.appendChild(subHeader);
    } else if (this.view === 'list' || this.view === 'templates' || this.view === 'archive') {
      container.classList.add('operations-tab-page');
      const titleBar = el('div', { class: 'page-title-bar-v2' });
      titleBar.appendChild(el('h1', { text: 'Operations' }));
      container.appendChild(titleBar);
      // Recompute tab counts from the freshly loaded local cache before rendering
      // the tab navigation so badges never display stale values.
      Workflow._refreshCounts();
      container.appendChild(this.renderTabNav());
    } else if (this.view === 'form') {
      // Full-page work-request form: breadcrumb with view switcher + save/cancel
      container.classList.add('operations-tab-page');
      const isNew = !this.editingId;
      const wr = isNew ? null : WorkflowData.getWorkRequestById(this.editingId);
      const fullPageRoute = isNew ? '#operations/form/new' : `#operations/form/${this.editingId}`;
      const viewSwitcher = buildFormViewSwitcher({
        currentMode: PaneMode.FULL_PAGE,
        viewContext: 'work-request-form',
        onSidePeek: () => {
          const editingId = this.editingId;
          closeFormPanelAndRoute('#operations');
          this.editingId = editingId;
          this.openWorkRequestForm(PaneMode.SIDE_PEEK);
        },
        onCenterPeek: () => {
          const editingId = this.editingId;
          closeFormPanelAndRoute('#operations');
          this.editingId = editingId;
          this.openWorkRequestForm(PaneMode.CENTER_PEEK);
        },
        onNewTab: () => {
          window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
        }
      });
      container.appendChild(buildFormBreadcrumb({
        baseLabel: 'Operations',
        baseHash: '#operations',
        currentText: isNew ? 'New Work Request' : (wr?.title || 'Edit Work Request'),
        viewSwitcher,
        actions: [
          { text: isNew ? 'Submit Request' : 'Save Changes', class: 'btn btn-primary btn-sm', type: 'submit', form: 'wr-form' },
          { text: 'Cancel', class: 'btn btn-secondary btn-sm', onClick: () => { location.hash = '#operations'; } }
        ]
      }));
    } else if (this.view === 'templateForm') {
      // Full-page retainer template form: breadcrumb with view switcher + save/cancel
      container.classList.add('operations-tab-page');
      const isNew = !this.templateEditingId;
      const template = isNew ? null : this._getRetainerTemplateById(this.templateEditingId);
      const fullPageRoute = isNew ? '#operations/templateForm/new' : `#operations/templateForm/${this.templateEditingId}`;
      const viewSwitcher = buildFormViewSwitcher({
        currentMode: PaneMode.FULL_PAGE,
        viewContext: 'retainer-template-form',
        onSidePeek: async () => {
          const templateEditingId = this.templateEditingId;
          closeFormPanelAndRoute('#operations');
          this.templateEditingId = templateEditingId;
          await this.openRetainerTemplateForm(PaneMode.SIDE_PEEK);
        },
        onCenterPeek: async () => {
          const templateEditingId = this.templateEditingId;
          closeFormPanelAndRoute('#operations');
          this.templateEditingId = templateEditingId;
          await this.openRetainerTemplateForm(PaneMode.CENTER_PEEK);
        },
        onNewTab: () => {
          window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
        }
      });
      container.appendChild(buildFormBreadcrumb({
        baseLabel: 'Operations',
        baseHash: '#operations',
        currentText: isNew ? 'New Retainer Template' : (template?.name || 'Edit Template'),
        viewSwitcher,
        actions: [
          { text: 'Save Template', class: 'btn btn-primary btn-sm', type: 'submit', form: 'template-form' },
          { text: 'Cancel', class: 'btn btn-secondary btn-sm', onClick: () => { location.hash = '#operations'; } }
        ]
      }));
    } else if (this.view === 'addTask' && this.addTaskWrId) {
      container.classList.add('operations-tab-page');
      const wr = WorkflowData.getWorkRequestById(this.addTaskWrId);
      const fullPageRoute = '#operations/addTask/' + this.addTaskWrId;
      const viewSwitcher = buildFormViewSwitcher({
        currentMode: PaneMode.FULL_PAGE,
        viewContext: 'add-task-form',
        onSidePeek: async () => {
          const wrId = this.addTaskWrId;
          closeFormPanelAndRoute('#operations/detail/' + wrId);
          await this.showAddTaskPanel(wrId, PaneMode.SIDE_PEEK);
        },
        onCenterPeek: async () => {
          const wrId = this.addTaskWrId;
          closeFormPanelAndRoute('#operations/detail/' + wrId);
          await this.showAddTaskPanel(wrId, PaneMode.CENTER_PEEK);
        },
        onNewTab: () => {
          window.open(location.origin + location.pathname + fullPageRoute, '_blank', 'noopener,noreferrer');
        }
      });
      container.appendChild(buildFormBreadcrumb({
        baseLabel: 'Operations',
        baseHash: '#operations',
        currentText: 'Add Task',
        viewSwitcher,
        actions: [
          { text: 'Add Task', class: 'btn btn-primary btn-sm', type: 'submit', form: 'add-task-form' },
          { text: 'Cancel', class: 'btn btn-secondary btn-sm', onClick: () => { location.hash = '#operations/detail/' + this.addTaskWrId; } }
        ]
      }));
    }

    if (this.view === 'list') {
      container.appendChild(this.renderList());
    } else if (this.view === 'form') {
      container.appendChild(await this.renderForm());
    } else if (this.view === 'detail') {
      container.appendChild(await this.renderDetail());
    } else if (this.view === 'templates') {
      container.appendChild(await this.renderTemplates());
    } else if (this.view === 'templateForm') {
      container.appendChild(await this.renderTemplateForm({ hideHeader: true }));
    } else if (this.view === 'archive') {
      container.appendChild(await this.renderArchive());
    } else if (this.view === 'addTask' && this.addTaskWrId) {
      const form = await this.renderAddTaskForm(this.addTaskWrId, { hideHeader: true });
      if (form) {
        container.appendChild(el('div', { class: 'page-content-section' }, [form]));
      } else {
        location.hash = '#operations/detail/' + this.addTaskWrId;
      }
    }

    setTimeout(() => this.updateStickyOffsets(), 0);
    delete this._tempTaskMap;
    return container;
  },

  init() {
    this.updateStickyOffsets();

    // Only register one global click handler for the module; replace the previous
    // one so repeated route renders do not leak document listeners.
    if (this._workflowGlobalClickListener) {
      document.removeEventListener('click', this._workflowGlobalClickListener);
    }
    this._workflowGlobalClickListener = () => {
      document.querySelectorAll('.multi-select-menu.show').forEach(m => m.classList.remove('show'));
      document.querySelectorAll('.action-menu-list').forEach(m => {
        m.classList.add('hidden');
        m.classList.remove('open');
      });
    };
    document.addEventListener('click', this._workflowGlobalClickListener);
    if (this.view === 'detail' && this.prefilledTransmittalRequestId) {
      const reqId = this.prefilledTransmittalRequestId;
      this.prefilledTransmittalRequestId = null;
      const wr = WorkflowData.getWorkRequestById(this.detailWrId);
      if (wr) {
        setTimeout(() => this.openGenerateTransmittalModal(wr, null, reqId), 100);
      }
    }
  },

  updateStickyOffsets() {
    App.updateStickyOffsets();
  },

  renderTabNav() {
    const entity = Auth.activeEntity;
    if (this._counts && this._countsEntity !== entity) {
      this._counts = null;
      this._countsEntity = null;
    }
    const taskMap = this._tempTaskMap || buildTaskMap();
    const wrCount = WorkflowData.hasData() ? WorkflowData.getWorkRequestsWhere(wr => {
      const wrEnt = (wr.entity || '').toUpperCase();
      const matchesEntity = (entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(wrEnt) : wrEnt === entity.toUpperCase());
      return matchesEntity && this._isActiveWorkRequest(wr) && Auth.canViewWrWithTasks(wr, taskMap);
    }).length : (this._counts?.active >= 0 ? this._counts.active : 0);

    const templateCount = (this._retainerTemplates || []).filter(t => {
      const tEnt = (t.entity || '').toUpperCase();
      if (entity === 'ALL') {
        return Auth.user.entities.map(ae => ae.toUpperCase()).includes(tEnt);
      }
      return tEnt === entity.toUpperCase();
    }).length;

    const archiveWrCount = WorkflowData.hasData() ? WorkflowData.getWorkRequestsWhere(wr => {
      const wrEnt = (wr.entity || '').toUpperCase();
      const matchesEntity = (entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(wrEnt) : wrEnt === entity.toUpperCase());
      return matchesEntity && !this._isActiveWorkRequest(wr) && Auth.canViewWrWithTasks(wr, taskMap);
    }).length : (this._counts?.archived >= 0 ? this._counts.archived : 0);

    const rejectedCount = WorkflowData.getPendingApprovalsWhere(pc => {
      if (pc.status !== 'rejected') return false;
      if (!['workRequests', 'tasks'].includes(pc.table)) return false;
      const data = pc.proposedData || {};
      const wrId = pc.table === 'tasks' ? data.workRequestId : data.id;
      const wr = wrId ? WorkflowData.getWorkRequestById(wrId) : null;
      const ent = (wr?.entity || data.entity || '').toUpperCase();
      const matchesEntity = (entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(ent) : ent === entity.toUpperCase());
      if (!matchesEntity) return false;
      if (!Auth.isManagerial() && pc.submittedBy !== Auth.user.id) return false;
      return true;
    }).length;

    const archiveCount = archiveWrCount + rejectedCount;

    const tabs = [
      { key: 'list', label: 'Work Requests', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', count: wrCount }
    ];

    if (Auth.can('workflow:approve')) {
      tabs.push({ key: 'templates', label: 'Retainer Templates', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>', count: templateCount });
    }

    tabs.push({ key: 'archive', label: 'Archive', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>', count: archiveCount });

    const tabNav = renderModuleTabNav(tabs, this.view, (key) => {
      this.view = key;
      App.handleRoute();
    });

    if (Auth.can('workflow:edit')) {
      const addBtn = el('button', {
        class: 'btn btn-primary btn-sm',
        style: 'margin-left: 16px; display: inline-flex; align-items: center; gap: 6px;',
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Work Request'
      });
      addBtn.addEventListener('click', () => {
        this.editingId = null;
        this.openWorkRequestForm();
      });
      tabNav.appendChild(addBtn);
    }

    return tabNav;
  },

  // ============================================================
  // List View
  // ============================================================
  renderList() {
    const entity = Auth.activeEntity;
    const canApprove = Auth.can('workflow:approve');
    const canEdit = Auth.can('workflow:edit');

    const wrapper = el('div');
    const stickyContainer = el('div', { class: 'toolbar-sticky-container' });
    const jiraToolbar = el('div', { class: 'jira-toolbar' });

    // View mode toggle
    const viewMode = App.getPreferredViewMode('operations') || 'table';
    const vmToggle = el('div', { class: 'view-mode-toggle' });
    const vmTable = el('button', { html: ViewIcons.table + ' Table', class: viewMode === 'table' ? 'active' : '', type: 'button' });
    const vmBoard = el('button', { html: ViewIcons.board + ' Board', class: viewMode === 'board' ? 'active' : '', type: 'button' });
    const vmList = el('button', { html: ViewIcons.list + ' List', class: viewMode === 'list' ? 'active' : '', type: 'button' });
    vmTable.addEventListener('click', () => { saveCurrentFilters(); App.setPreferredViewMode('operations', 'table'); App.handleRoute(); });
    vmBoard.addEventListener('click', () => { saveCurrentFilters(); App.setPreferredViewMode('operations', 'board'); App.handleRoute(); });
    vmList.addEventListener('click', () => { saveCurrentFilters(); App.setPreferredViewMode('operations', 'list'); App.handleRoute(); });
    vmToggle.appendChild(vmTable);
    vmToggle.appendChild(vmBoard);
    vmToggle.appendChild(vmList);

    // Group-by state
    let groupBy = App.restoreGroupBy('operations') || 'none';
    const groupOptions = [
      { key: 'none', label: 'None' },
      { key: 'assignee', label: 'Assignee' },
      { key: 'client', label: 'Client' },
      { key: 'priority', label: 'Priority' }
    ];

    // Active filter state (Jira-style multi-select per category)
    const activeFilters = {
      assignee: new Set(),
      priority: new Set(),
      dueDate: new Set(),
      client: new Set()
    };
    let searchQuery = '';

    // Server-side pagination state for board/table/list views.
    const PAGE_SIZE = 50;
    let page = 1;
    let totalPages = 1;
    let pageMeta = {};
    let refreshGeneration = 0;

    // Restore saved filters (v2 format)
    const savedFilters = App.restoreFilters('operations');
    if (savedFilters && savedFilters.v2) {
      Object.keys(activeFilters).forEach(cat => {
        if (Array.isArray(savedFilters[cat])) savedFilters[cat].forEach(v => activeFilters[cat].add(v));
      });
    }

    // Category value sources
    const getScopedUsers = () => (window.apiClient.userCache._users || []).filter(u => {
      const userEnts = (u.entities || []).map(e => e.toUpperCase());
      if (entity === 'ALL') return userEnts.some(e => Auth.user.entities.map(ae => ae.toUpperCase()).includes(e));
      return userEnts.includes(entity.toUpperCase());
    });

    const getScopedClients = () => (window.apiClient.clientCache._clients || []).filter(c => {
      const clientEnt = (c.entity || '').toUpperCase();
      if (entity === 'ALL') return Auth.user.entities.map(ae => ae.toUpperCase()).includes(clientEnt);
      return clientEnt === entity.toUpperCase();
    });

    const getAssigneeOptions = () => {
      const options = new Map();
      options.set('__UNASSIGNED__', { value: '__UNASSIGNED__', label: 'Unassigned' });
      getScopedUsers().forEach(u => options.set(u.name, { value: u.name, label: u.name }));
      (WorkflowData.getAllTasks() || []).forEach(t => {
        const name = (t.assigneeName || '').trim();
        if (name) options.set(name, { value: name, label: name });
      });
      return Array.from(options.values());
    };

    const getPriorityOptions = () => {
      const defaultPriorities = ['Urgent', 'Priority', 'Low Priority'];
      const set = new Set(defaultPriorities);
      WorkflowData.getWorkRequestsWhere(r => {
        const matchesEntity = (entity === 'ALL' ? Auth.user.entities.includes(r.entity) : r.entity === entity);
        return matchesEntity && !r.archived && r.status !== 'Cancelled';
      }).forEach(r => {
        if (r.priority) set.add(r.priority);
      });
      return Array.from(set).map(p => ({ value: p, label: p }));
    };

    const getDueDateOptions = () => [
      { value: 'Overdue', label: 'Overdue' },
      { value: 'Due Today', label: 'Due Today' },
      { value: 'Due This Week', label: 'Due This Week' },
      { value: 'Due This Month', label: 'Due This Month' },
      { value: 'Due Later', label: 'Due Later' },
      { value: 'No Due Date', label: 'No Due Date' }
    ];

    const getClientOptions = () => getScopedClients().map(c => ({ value: c.id, label: c.name }));

    const categories = {
      assignee: { label: 'Assignee', getOptions: getAssigneeOptions },
      priority: { label: 'Priority', getOptions: getPriorityOptions },
      dueDate: { label: 'Due date', getOptions: getDueDateOptions },
      client: { label: 'Client', getOptions: getClientOptions }
    };
    let selectedCategory = 'assignee';

    const getActiveFilterCount = () => Object.values(activeFilters).reduce((sum, set) => sum + set.size, 0);

    const saveCurrentFilters = () => {
      App.saveFilters('operations', {
        v2: true,
        assignee: Array.from(activeFilters.assignee),
        priority: Array.from(activeFilters.priority),
        dueDate: Array.from(activeFilters.dueDate),
        client: Array.from(activeFilters.client)
      });
    };

    const applyFilters = (wrs, taskMap) => {
      let result = wrs.slice();
      const resolvedTaskMap = taskMap || this._tempTaskMap || buildTaskMap();

      if (activeFilters.assignee.size > 0) {
        const hasUnassigned = activeFilters.assignee.has('__UNASSIGNED__');
        result = result.filter(r => {
          const names = this.getWorkRequestAssigneeNames(r, resolvedTaskMap);
          if (names.size === 0) return hasUnassigned;
          return Array.from(names).some(name => activeFilters.assignee.has(name));
        });
      }

      if (activeFilters.priority.size > 0) {
        result = result.filter(r => {
          const wrPriority = r.priority || 'Normal';
          if (activeFilters.priority.has(wrPriority)) return true;
          const tasks = resolvedTaskMap[r.id] || [];
          return tasks.some(t => activeFilters.priority.has(t.priority || 'Normal'));
        });
      }

      if (activeFilters.dueDate.size > 0) {
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);

        const endOfWeek = new Date(now);
        const dayOfWeek = now.getDay();
        const distanceToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
        endOfWeek.setDate(now.getDate() + distanceToSunday);
        const endOfWeekStr = endOfWeek.toISOString().slice(0, 10);

        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const endOfMonthStr = endOfMonth.toISOString().slice(0, 10);

        result = result.filter(r => {
          if (!r.dueDate) {
            return activeFilters.dueDate.has('No Due Date');
          }
          const dStr = r.dueDate.slice(0, 10);

          if (activeFilters.dueDate.has(`DATE:${dStr}`)) return true;

          let bucket = 'No Due Date';
          if (dStr < todayStr) bucket = 'Overdue';
          else if (dStr === todayStr) bucket = 'Due Today';
          else if (dStr <= endOfWeekStr) bucket = 'Due This Week';
          else if (dStr <= endOfMonthStr) bucket = 'Due This Month';
          else bucket = 'Due Later';

          return activeFilters.dueDate.has(bucket);
        });
      }

      if (activeFilters.client.size > 0) {
        result = result.filter(r => activeFilters.client.has(r.clientId));
      }

      if (searchQuery) {
        result = result.filter(r => {
          const client = window.apiClient.clientCache.getById(r.clientId);
          const assignees = Array.from(this.getWorkRequestAssigneeNames(r, resolvedTaskMap));
          const hay = [
            r.title || '',
            client?.name || '',
            r.status || '',
            r.description || '',
            ...assignees
          ].join(' ').toLowerCase();
          return hay.includes(searchQuery);
        });
      }

      return result;
    };

    // Group dropdown
    const groupWrap = el('div', { class: 'jira-group-wrap' });
    const groupIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';
    const groupCaretSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const groupTrigger = el('button', {
      type: 'button',
      class: 'jira-group-trigger'
    });
    const renderGroupTrigger = () => {
      const selected = groupOptions.find(opt => opt.key === groupBy);
      const label = groupBy === 'none' ? 'Group' : 'Group: ' + (selected ? selected.label : 'Group');
      groupTrigger.classList.toggle('active', groupBy !== 'none');
      groupTrigger.innerHTML = groupIconSvg + ' <span>' + escapeHtml(label) + '</span> ' + groupCaretSvg;
    };
    renderGroupTrigger();
    const groupDropdown = el('div', { class: 'jira-dropdown jira-group-dropdown hidden' });
    const renderGroupDropdown = () => {
      groupDropdown.innerHTML = '';
      groupOptions.forEach(opt => {
        const active = groupBy === opt.key;
        const btn = el('button', {
          type: 'button',
          class: 'jira-group-option' + (active ? ' active' : ''),
          html: escapeHtml(opt.label) + (active ? ' <span class="checkmark"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' : '')
        });
        btn.addEventListener('click', () => {
          groupBy = opt.key;
          App.saveGroupBy('operations', groupBy);
          renderGroupTrigger();
          renderGroupDropdown();
          groupDropdown.classList.add('hidden');
          refresh();
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

    // Filter dropdown
    const filterWrap = el('div', { class: 'jira-filter-wrap' });
    const filterTrigger = el('button', {
      type: 'button',
      class: 'jira-filter-trigger',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="11" y2="16"/></svg> Filter'
    });
    const filterBadge = el('span', { class: 'jira-filter-badge hidden' });
    filterTrigger.appendChild(filterBadge);
    const filterDropdown = el('div', { class: 'jira-dropdown jira-filter-dropdown hidden' });

    const renderFilterValues = () => {
      const options = categories[selectedCategory].getOptions();
      const list = filterDropdown.querySelector('.jira-filter-values-list');
      if (!list) return;
      list.innerHTML = '';

      const searchInput = filterDropdown.querySelector('.jira-filter-search');
      const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

      let visibleCount = 0;
      const allOptions = options.slice();

      if (selectedCategory === 'dueDate') {
        const dateWrap = el('div', { class: 'jira-filter-select-date-wrap' });

        let activeCustomDate = '';
        activeFilters.dueDate.forEach(val => {
          if (val.startsWith('DATE:')) activeCustomDate = val.slice(5);
        });

        const dateInput = el('input', {
          type: 'date',
          class: 'jira-filter-date-input',
          value: activeCustomDate || ''
        });

        dateInput.addEventListener('change', (e) => {
          e.stopPropagation();
          const val = dateInput.value;
          Array.from(activeFilters.dueDate).forEach(v => {
            if (v.startsWith('DATE:')) activeFilters.dueDate.delete(v);
          });
          if (val) {
            activeFilters.dueDate.add(`DATE:${val}`);
          }
          saveCurrentFilters();
          updateFilterUI();
          refresh();
          updateToolbar();
        });

        dateWrap.appendChild(dateInput);
        list.appendChild(dateWrap);

        if (!dateInput.dataset.mdpAttached && typeof MaterialDatePicker !== 'undefined' && typeof MaterialDatePicker.attach === 'function') {
          setTimeout(() => MaterialDatePicker.attach(dateInput), 0);
        }
      }

      if (allOptions.length === 0) {
        list.appendChild(el('div', { class: 'jira-filter-values-empty', text: 'No results' }));
      } else {
        allOptions.forEach(opt => {
          const isChecked = activeFilters[selectedCategory].has(opt.value);
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
            if (activeFilters[selectedCategory].has(opt.value)) {
              activeFilters[selectedCategory].delete(opt.value);
            } else {
              activeFilters[selectedCategory].add(opt.value);
            }
            saveCurrentFilters();
            updateFilterUI();
            refresh();
            updateToolbar();
          });

          list.appendChild(row);
        });
      }

      const footer = filterDropdown.querySelector('.jira-filter-values-footer');
      if (footer) {
        footer.innerHTML = '';
        const selectedInCat = activeFilters[selectedCategory].size;
        const clearCatBtn = el('button', {
          type: 'button',
          class: 'jira-filter-clear-cat' + (selectedInCat > 0 ? '' : ' disabled'),
          text: 'Clear'
        });
        if (selectedInCat > 0) {
          clearCatBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            activeFilters[selectedCategory].clear();
            saveCurrentFilters();
            updateFilterUI();
            refresh();
            updateToolbar();
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
            if (activeFilters[cat].size > 0) {
              catBtn.appendChild(el('span', { class: 'cat-count', text: String(activeFilters[cat].size) }));
            }
          }
        });
      }

      const clearAllBtn = filterDropdown.querySelector('.jira-filter-clear-all');
      if (clearAllBtn) {
        const totalActive = getActiveFilterCount();
        clearAllBtn.className = 'jira-filter-clear-all' + (totalActive > 0 ? '' : ' disabled');
      }

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
        if (activeFilters[cat].size > 0) {
          catBtn.appendChild(el('span', { class: 'cat-count', text: String(activeFilters[cat].size) }));
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
        Object.keys(activeFilters).forEach(cat => activeFilters[cat].clear());
        App.clearSavedFilters('operations');
        updateFilterUI();
        refresh();
        updateToolbar();
      });
      catFooter.appendChild(clearAllBtn);
      leftPane.appendChild(catFooter);

      // Right Pane: Values for selected category
      const rightPane = el('div', { class: 'jira-filter-values' });
      const valuesHeader = el('div', { class: 'jira-filter-values-header' });
      const searchIcon = el('span', {
        class: 'jira-filter-search-icon',
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
      });
      const searchInput = el('input', {
        type: 'text',
        class: 'jira-filter-search',
        placeholder: `Search ${categories[selectedCategory].label.toLowerCase()}`
      });
      searchInput.addEventListener('input', () => {
        renderFilterValues();
      });
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

      // Global Footer: Keyboard shortcut hint
      const globalFooter = el('div', { class: 'jira-filter-global-footer' });
      const shortcutHint = el('div', {
        class: 'jira-filter-shortcut-hint',
        html: 'Press <kbd>Shift</kbd> + <kbd>F</kbd> to open and close'
      });
      globalFooter.appendChild(shortcutHint);
      filterDropdown.appendChild(globalFooter);

      renderFilterValues();
    };

    const toggleFilterDropdown = (e) => {
      if (e) e.stopPropagation();
      groupDropdown.classList.add('hidden');
      const isHidden = filterDropdown.classList.contains('hidden');
      if (isHidden) {
        filterDropdown.classList.remove('hidden');
        renderFilterDropdown();
        const searchInput = filterDropdown.querySelector('.jira-filter-search');
        if (searchInput) searchInput.focus();
      } else {
        filterDropdown.classList.add('hidden');
      }
    };

    filterTrigger.addEventListener('click', (e) => {
      toggleFilterDropdown(e);
    });
    filterTrigger._toggleFilterDropdown = toggleFilterDropdown;

    filterWrap.appendChild(filterTrigger);
    filterWrap.appendChild(filterDropdown);

    // Search input (beside filter)
    const searchWrap = el('div', { class: 'jira-search-wrap' });
    const searchInput = el('input', {
      type: 'text',
      class: 'jira-search-input',
      placeholder: 'Search operations...',
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
      searchQuery = searchInput.value.trim().toLowerCase();
      clearBtn.classList.toggle('hidden', !searchQuery);
      refresh();
      updateToolbar();
    }, 200));

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.classList.add('hidden');
      searchQuery = '';
      refresh();
      updateToolbar();
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        clearBtn.classList.add('hidden');
        searchQuery = '';
        refresh();
        updateToolbar();
      }
    });

    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(clearBtn);

    // Clear filters button
    const clearFiltersBtn = el('button', { type: 'button', class: 'jira-clear-filters hidden', text: 'Clear filters' });
    clearFiltersBtn.addEventListener('click', () => {
      Object.keys(activeFilters).forEach(cat => activeFilters[cat].clear());
      searchInput.value = '';
      clearBtn.classList.add('hidden');
      searchQuery = '';
      App.clearSavedFilters('operations');
      updateFilterUI();
      refresh();
      updateToolbar();
    });

    const updateToolbar = () => {
      const count = getActiveFilterCount();
      filterBadge.textContent = String(count);
      filterBadge.classList.toggle('hidden', count === 0);
      clearFiltersBtn.classList.toggle('hidden', count === 0 && !searchQuery);
    };
    updateToolbar();

    jiraToolbar.appendChild(vmToggle);
    jiraToolbar.appendChild(searchWrap);
    jiraToolbar.appendChild(filterWrap);
    jiraToolbar.appendChild(clearFiltersBtn);
    if (viewMode === 'board') {
      jiraToolbar.appendChild(groupWrap);
    }
    stickyContainer.appendChild(jiraToolbar);
    wrapper.appendChild(stickyContainer);

    // Use the shared global Shift+F shortcut listener (Operations builds its own toolbar)
    if (typeof attachJiraGlobalShortcuts === 'function') attachJiraGlobalShortcuts();

    // Close dropdowns when clicking outside (setup once)
    if (!this._jiraToolbarClickListener) {
      this._jiraToolbarClickListener = (e) => {
        // If the target element was detached during click handling (e.g. datepicker OK/close or re-rendered list item), do NOT treat as outside click
        if (!e.target || !e.target.isConnected) return;

        const operationsContainer = document.querySelector('.operations-list-page, .operations-tab-page');
        if (!operationsContainer) return;
        if (
          e.target.closest('.jira-group-wrap') ||
          e.target.closest('.jira-filter-wrap') ||
          e.target.closest('.mdp-overlay') ||
          e.target.closest('.mdp-dialog') ||
          e.target.closest('.mdp-wrapper') ||
          e.target.closest('.mdp-container')
        ) {
          return;
        }
        operationsContainer.querySelectorAll('.jira-group-dropdown, .jira-filter-dropdown').forEach(d => d.classList.add('hidden'));

      };
      document.addEventListener('click', this._jiraToolbarClickListener);
    }

    const contentContainer = el('div');
    wrapper.appendChild(contentContainer);

    // Grouped/phase board headers share the same sticky top as the ungrouped
    // column headers. Use the module CSS variables so the value stays in sync
    // when the toolbar wraps or the grouped-board-active class changes.
    contentContainer.style.setProperty(
      '--board-column-header-top',
      'calc(var(--operations-title-bar-height, 48px) + var(--operations-tab-nav-height, 45px) + var(--operations-toolbar-height, 0px))'
    );

    const buildPageTaskMap = (wrs) => {
      const map = {};
      wrs.forEach(wr => { map[wr.id] = wr.tasks || []; });
      return map;
    };

    const renderPagination = () => {
      if (totalPages <= 1 && page === 1) return;
      const footer = el('div', { class: 'workflow-pagination', style: 'display: flex; align-items: center; justify-content: center; gap: 12px; padding: 16px 0;' });
      const prevBtn = el('button', {
        class: 'btn btn-secondary btn-sm',
        text: '‹ Previous',
        disabled: page <= 1
      });
      const nextBtn = el('button', {
        class: 'btn btn-secondary btn-sm',
        text: 'Next ›',
        disabled: page >= totalPages
      });
      const info = el('span', {
        class: 'workflow-page-info',
        style: 'font-size: 13px; color: var(--color-text-muted);',
        text: `Page ${page}${totalPages ? ' of ' + totalPages : ''}`
      });

      prevBtn.addEventListener('click', () => { if (page > 1) { page--; refresh(); } });
      nextBtn.addEventListener('click', () => { if (page < totalPages) { page++; refresh(); } });

      footer.appendChild(prevBtn);
      footer.appendChild(info);
      footer.appendChild(nextBtn);
      contentContainer.appendChild(footer);
    };

    const refresh = async () => {
      const gen = ++refreshGeneration;
      while (contentContainer.firstChild) contentContainer.removeChild(contentContainer.firstChild);

      const shouldSkipServerFetch = Workflow._activeSkipGeneration > 0 && Workflow._activeSkipGeneration === Workflow._skipFetchGeneration;

      // Always ensure the in-memory cache is loaded for the active entity. If it
      // is already warm (including during an optimistic skip), this returns
      // immediately without overwriting optimistic records.
      await WorkflowData.ensure();

      await WorkflowData.loadPendingApprovals();
      const pendingChanges = WorkflowData.getPendingApprovalsWhere(pc => pc.status === 'pending' && pc.table === 'workRequests' && !pc.parentRecordId);
      const pendingWrs = pendingChanges.map(pc => {
        const wr = { ...pc.proposedData };
        wr.isPendingApproval = true;
        wr.pendingChangeId = pc.id;
        wr.submittedBy = pc.submittedBy;
        wr.status = 'Draft';
        return wr;
      });

      let wrs = WorkflowData.getWorkRequestsWhere(r => {
        const matchesEntity = (entity === 'ALL' ? Auth.user.entities.includes(r.entity) : r.entity === entity);
        return matchesEntity && !r.archived && r.status !== 'Cancelled';
      }).map(wr => ({ ...wr, entity: wr.entity || entity }));

      wrs = wrs.concat(pendingWrs.filter(r => {
        const matchesEntity = (entity === 'ALL' ? Auth.user.entities.includes(r.entity) : r.entity === entity);
        return matchesEntity;
      }));

      const listTaskMap = buildPageTaskMap(wrs);
      wrs = wrs.filter(r => Auth.canViewWrWithTasks(r, listTaskMap));
      wrs = applyFilters(wrs, listTaskMap);

      if (gen !== refreshGeneration) return;

      // Client-side pagination over the filtered cached set.
      const totalItems = wrs.length;
      totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
      page = Math.min(Math.max(1, page), totalPages);
      const start = (page - 1) * PAGE_SIZE;
      const paginatedWrs = wrs.slice(start, start + PAGE_SIZE);
      pageMeta = { total: totalItems, totalPages, page };

      const hasActiveFilters = getActiveFilterCount() > 0 || !!searchQuery;
      if (viewMode === 'table') this.refreshTable(contentContainer, paginatedWrs, hasActiveFilters);
      else if (viewMode === 'board') this.refreshBoard(contentContainer, paginatedWrs, groupBy, hasActiveFilters, stickyContainer);
      else this.refreshListCompact(contentContainer, paginatedWrs, hasActiveFilters);

      if (shouldSkipServerFetch) {
        // Simple cached-results indicator while we skip the server round-trip.
        contentContainer.appendChild(el('div', {
          class: 'workflow-cached-indicator',
          style: 'text-align:center; padding:8px 0; font-size:12px; color:var(--color-text-muted);',
          text: 'Showing cached results'
        }));
      }

      renderPagination();

      // Re-measure sticky offsets after the next paint so toolbar height changes
      // (grouped-board-active toggle, wrapping filters) are reflected.
      requestAnimationFrame(() => this.updateStickyOffsets());

      // Background refresh: silently merge any new/updated server records into
      // the in-memory cache without replacing optimistic records.
      if (!shouldSkipServerFetch) {
        WorkflowData.backgroundRefresh().catch(err => {
          if (!isAbortError(err)) console.warn('Workflow background refresh failed', err);
        });
      }
    };

    refresh();

    return wrapper;
  },

  refreshTable(container, wrs, hasActiveFilters = false) {
    const canEdit = Auth.can('workflow:edit');
    const canApprove = Auth.can('workflow:approve');
    if (wrs.length === 0) {
      const entity = Auth.activeEntity;
      const allWrs = WorkflowData.getWorkRequestsWhere(r => {
        const matchesEntity = (entity === 'ALL' ? Auth.user.entities.includes(r.entity) : r.entity === entity);
        return matchesEntity && !r.archived && r.status !== 'Cancelled';
      });
      const savedHasFilters = App.hasSavedFilters('operations');
      hasActiveFilters = hasActiveFilters || savedHasFilters;
      const hasWorkRequests = allWrs.length > 0;

      if (hasWorkRequests && hasActiveFilters) {
        container.appendChild(renderFilterEmptyState(
          'No work requests match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('operations'); App.handleRoute(); } }]
        ));
      } else {
        const actions = [];
        if (canEdit) {
          actions.push({
            text: '+ Add Work Request',
            className: 'btn btn-primary btn-sm',
            onClick: () => {
              this.editingId = null;
        this.openWorkRequestForm();
            }
          });
        }
        container.appendChild(renderEmptyStateV2({
          variant: 'zero-state',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>',
          title: hasWorkRequests ? 'No work requests in this view' : 'No work requests yet',
          body: hasWorkRequests
            ? 'Work requests are hidden by the current filters or status settings.'
            : 'Create your first work request to start tracking client work.',
          actions
        }));
      }
      return;
    }

    const buildActions = (wr) => {
      const wrapper = el('div', { style: 'display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end; white-space: nowrap;' });

      const viewBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'View' });
      viewBtn.addEventListener('click', (e) => { e.stopPropagation(); this._navigateToWrDetail(wr.id); });
      wrapper.appendChild(viewBtn);

      if (isPendingWr(wr)) {
        if (canEdit) {
          const editBtn = el('button', {
            class: 'btn btn-secondary btn-sm',
            html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px; vertical-align:middle;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>Edit'
          });
          disableForApproval(editBtn);
          wrapper.appendChild(editBtn);
        }
        if (Auth.user.id === wr.submittedBy || Auth.isManagerial()) {
          const cancelBtn = el('button', {
            class: 'btn btn-danger btn-sm',
            html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Cancel',
            style: 'margin-left: 4px;'
          });
          cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            Workflow.showConfirm('Confirm Cancellation', 'Are you sure you want to cancel and withdraw this request?', () => {
              PendingChanges.delete(wr.pendingChangeId);
              App.handleRoute();
            }, 'danger');
          });
          wrapper.appendChild(cancelBtn);
        }
      } else {
        if (canEdit && wr.status === 'Draft') {
          const editBtn = el('button', {
            class: 'btn btn-secondary btn-sm',
            html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px; vertical-align:middle;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>Edit'
          });
          editBtn.addEventListener('click', (e) => { e.stopPropagation(); location.hash = '#operations/form/' + wr.id; });
          wrapper.appendChild(editBtn);
        }

        if (canApprove && wr.status !== 'Completed' && wr.status !== 'Cancelled') {
          const ts = this.getPhaseTransitionStatus(wr.id);
          if (ts && ts.canTransition && ts.nextPhase) {
            const routeBtn = el('button', {
              html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg> Route',
              style: 'color:#10b981;font-weight:600;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius: 12px;padding:2px 8px;margin-left:4px;cursor:pointer;font-size:11px;display:inline-flex;align-items:center;gap:3px;'
            });
            routeBtn.title = 'Route to ' + ts.nextPhase;
            routeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.transitionWorkRequest(wr.id); });
            wrapper.appendChild(routeBtn);
          }
        }

        if (Auth.isManagerial() && wr.status !== 'Completed' && wr.status !== 'Cancelled') {
          const cancelBtn = el('button', { class: 'btn btn-danger btn-sm', text: 'Cancel', style: 'margin-left: 4px;' });
          cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); this.cancelWorkRequest(wr.id); });
          wrapper.appendChild(cancelBtn);
        }

        if (wr.status === 'Completed' && !wr.archived) {
          const archiveBtn = el('button', { class: 'btn btn-primary btn-sm', text: 'Archive', style: 'margin-left: 4px;' });
          archiveBtn.addEventListener('click', (e) => { e.stopPropagation(); this.archiveWorkRequest(wr.id); });
          wrapper.appendChild(archiveBtn);
        }
      }

      // Blocker badge placed on the rightmost side of the action buttons
      if (canApprove && wr.status !== 'Completed' && wr.status !== 'Cancelled' && !isPendingWr(wr)) {
        const ts = this.getPhaseTransitionStatus(wr.id);
        if (ts && ts.missing && ts.missing.length > 0) {
          const blockerBadge = el('span', {
            class: 'dt-blocker-badge',
            html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg> ' + ts.missing.length,
            title: ts.missing.join('\n'),
            style: 'margin-left: 6px; white-space: nowrap;'
          });
          wrapper.appendChild(blockerBadge);
        }
      }

      return wrapper;
    };

    const columns = [
      {
        key: 'title',
        label: 'Work Request',
        width: '32%',
        render: (wr) => {
          const cell = el('div', { class: 'dt-title-cell' });
          const titleLine = el('div', { style: 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;' });
          titleLine.appendChild(el('span', { class: 'dt-title-link', text: wr.title }));
          if (wr.isPendingApproval) {
            titleLine.appendChild(el('span', {
              text: 'Awaiting Approval',
              style: 'font-size: 10px; border-radius: 12px; display: inline-block; padding: 1px 4px; background: var(--color-bg-muted); color: var(--color-warning); font-weight: 600; border: 1px solid var(--color-warning); white-space: nowrap;'
            }));
          }
          cell.appendChild(titleLine);
          const badges = el('div', { class: 'dt-title-badges' });
          badges.appendChild(this.getFinanceBadgeForWr(wr));
          const itemsBadge = this.getItemsBadgeForWr(wr);
          if (itemsBadge) badges.appendChild(itemsBadge);
          badges.appendChild(this.getDocBadgeForWr(wr));
          cell.appendChild(badges);
          return cell;
        }
      },
      { key: 'clientId', label: 'Client', width: '20%', render: (wr) => window.apiClient.clientCache.getById(wr.clientId)?.name || '—' },
      { key: 'priority', label: 'Priority', render: (wr) => DataTable.priorityCell(wr.priority), width: '110px' },
      {
        key: 'status',
        label: 'Status',
        width: '135px',
        render: (wr) => wr.isPendingApproval
          ? el('span', { text: 'Awaiting Approval', style: 'background: var(--color-bg-muted); color: var(--color-warning); font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 12px; display: inline-block; white-space: nowrap;' })
          : this.statusBadge(wr.status)
      },
      { key: 'dueDate', label: 'Due Date', render: (wr) => wr.dueDate ? el('span', { text: formatDate(wr.dueDate), style: 'white-space: nowrap;' }) : '—', width: '120px' },
      { key: 'actions', label: 'Actions', render: (wr) => buildActions(wr), class: 'dt-actions-col', width: '210px' }
    ];

    const tableView = DataTable.render({
      items: wrs,
      columns,
      selectable: true,
      showIcon: false,
      bulkActions: (ids) => {
        const rows = ids.map(id => WorkflowData.getWorkRequestById(id)).filter(Boolean);
        const canArchive = rows.filter(wr => wr.status === 'Completed' && !wr.archived).length;
        const canCancel = rows.filter(wr => wr.status !== 'Completed' && wr.status !== 'Cancelled').length;
        const actions = [];
        if (canArchive > 0) {
          actions.push({
            text: `Archive (${canArchive})`,
            className: 'btn btn-primary btn-sm',
            onClick: (sel) => this.bulkArchiveWorkRequests(sel)
          });
        }
        if (Auth.isManagerial() && canCancel > 0) {
          actions.push({
            text: `Cancel (${canCancel})`,
            className: 'btn btn-danger btn-sm',
            onClick: (sel) => this.bulkCancelWorkRequests(sel)
          });
        }
        return actions;
      },
      rowId: (wr) => wr.id,
      onRowClick: (wr) => { this._navigateToWrDetail(wr.id); },
      rowClass: (wr) => isPendingWr(wr) ? 'pending-approval-row' : ''
    });

    container.appendChild(tableView);
  },

  refreshBoard(container, wrs, groupBy = 'none', hasActiveFilters = false, toolbarContainer = null) {
    if (wrs.length === 0) {
      const entity = Auth.activeEntity;
      const allWrs = WorkflowData.getWorkRequestsWhere(r => {
        const matchesEntity = (entity === 'ALL' ? Auth.user.entities.includes(r.entity) : r.entity === entity);
        return matchesEntity && !r.archived && r.status !== 'Cancelled';
      });
      const savedHasFilters = App.hasSavedFilters('operations');
      hasActiveFilters = hasActiveFilters || savedHasFilters;
      const hasWorkRequests = allWrs.length > 0;

      if (hasWorkRequests && hasActiveFilters) {
        container.appendChild(renderFilterEmptyState(
          'No work requests match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('operations'); App.handleRoute(); } }]
        ));
      } else {
        const canEdit = Auth.can('workflow:edit');
        const actions = [];
        if (canEdit) {
          actions.push({
            text: '+ Add Work Request',
            className: 'btn btn-primary btn-sm',
            onClick: () => {
              this.editingId = null;
        this.openWorkRequestForm();
            }
          });
        }
        container.appendChild(renderEmptyStateV2({
          variant: 'zero-state',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>',
          title: hasWorkRequests ? 'No work requests in this view' : 'No work requests yet',
          body: hasWorkRequests
            ? 'Work requests are hidden by the current filters or status settings.'
            : 'Create your first work request to start tracking client work.',
          actions
        }));
      }
      return;
    }
    // Exclude cancelled from board
    wrs = wrs.filter(wr => wr.status !== 'Cancelled');
    wrs.forEach(wr => { wr.isOptimistic = WorkflowData._isTempId(wr.id); });
    const canEdit = Auth.can('workflow:edit');
    const canApprove = Auth.can('workflow:approve');
    const self = this;

    const openNewWrForm = () => {
      this.editingId = null;
        this.openWorkRequestForm();
    };

    const boardPhases = [
      { key: 'draft', label: 'Draft', statuses: ['Draft'], targetStatus: 'Draft', color: '#94a3b8' },
      { key: 'pre-processing', label: 'Pre-processing', statuses: ['Pre-processing', 'In Progress'], targetStatus: 'Pre-processing', color: '#3b82f6' },
      { key: 'processing', label: 'Processing', statuses: ['Processing', 'Billing', 'Disbursement', 'For Review'], targetStatus: 'Processing', color: '#f59e0b' },
      { key: 'completed', label: 'Completed', statuses: ['Completed'], targetStatus: 'Completed', color: '#10b981' }
    ];

    const seqMap = WorkflowData.getWorkRequestSeqMap();

    const renderBoardCard = (wr, phase) => {
      const tasks = wr.isPendingApproval ? (wr.tasks || []) : WorkflowData.getTasksWhere(t => t.workRequestId === wr.id);
      const completedTasks = tasks.filter(t => t.status === 'Completed').length;
      const totalTasks = tasks.length;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      const allComments = tasks.reduce((acc, t) => acc + (t.comments?.length || 0), 0);

      const assigneeIds = [...new Set(tasks.map(t => t.assigneeId || t.assignedTo).filter(Boolean))];
      let assignees = assigneeIds.map(id => window.apiClient.userCache.getById(id)).filter(Boolean);
      if (wr.isPendingApproval && assignees.length === 0) {
        const names = [...new Set(tasks.map(t => t.assigneeName).filter(Boolean))];
        names.forEach(name => {
          const u = (window.apiClient.userCache._users || [])
            .filter(usr => (usr.name || '').toLowerCase() === name.toLowerCase())[0];
          if (u) assignees.push(u);
        });
      }

      const client = window.apiClient.clientCache.getById(wr.clientId);
      const priorityConfig = {
        'Urgent': { label: 'Urgent', cls: 'card-v2-priority-urgent' },
        'Priority': { label: 'Priority', cls: 'card-v2-priority-priority' },
        'High': { label: 'High', cls: 'card-v2-priority-urgent' },
        'Low Priority': { label: 'Low', cls: 'card-v2-priority-low' },
        'Low': { label: 'Low', cls: 'card-v2-priority-low' }
      }[wr.priority] || { label: wr.priority || 'Priority', cls: 'card-v2-priority-normal' };

      const allChecklistItems = tasks.flatMap(t => t.checklist || []);
      const documentItems = allChecklistItems.filter(c => c.category === 'document');
      const subtaskItems = allChecklistItems.filter(c => c.category === 'subtask');
      const completedDocs = documentItems.filter(c => c.completed).length;
      const completedSubtasks = subtaskItems.filter(c => c.completed).length;

      const counts = [{
        icon: BoardCardIcons.task,
        value: `${completedTasks}/${totalTasks}`,
        title: `${completedTasks} of ${totalTasks} tasks completed`
      }];
      if (documentItems.length > 0) {
        counts.push({
          icon: BoardCardIcons.document,
          value: `${completedDocs}/${documentItems.length}`,
          title: `${completedDocs} of ${documentItems.length} required documents complete`
        });
      }
      if (subtaskItems.length > 0) {
        counts.push({
          icon: BoardCardIcons.checklist,
          value: `${completedSubtasks}/${subtaskItems.length}`,
          title: `${completedSubtasks} of ${subtaskItems.length} sub-tasks complete`
        });
      }
      if (allComments > 0) counts.push({ icon: BoardCardIcons.comment, value: allComments });

      return buildCompactBoardCard({
        key: 'WR-' + (seqMap.get(wr.id) || 1),
        progress,
        statusColor: phase.color,
        title: wr.title,
        description: client?.name || '—',
        detail: (wr.description || '').trim(),
        date: wr.dueDate ? formatDate(wr.dueDate) : '',
        priority: priorityConfig.label,
        priorityClass: priorityConfig.cls,
        avatars: assignees.slice(0, 3).map(u => ({ name: u.name, avatarUrl: u.avatarUrl })),
        counts,
        isOptimistic: wr.isOptimistic,
        onClick: () => { this._navigateToWrDetail(wr.id); }
      });
    };

    const renderCardMenuItems = (wr) => {
      const transitionStatus = self.getPhaseTransitionStatus(wr.id);
      const showQuickRoute = transitionStatus && transitionStatus.canTransition && transitionStatus.nextPhase;
      const items = [];

      items.push({
        label: 'View Details',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        onClick: () => { this._navigateToWrDetail(wr.id); }
      });

      if (showQuickRoute) {
        const canRouteDirectly = Auth.user?.role === 'Admin' || Auth.isManagerial() || Auth.can('workflow:approve');
        items.push({
          label: canRouteDirectly ? `Advance to ${transitionStatus.nextPhase}` : `Request Advance to ${transitionStatus.nextPhase}`,
          className: 'primary',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M19 12l-4-4m4 4l-4 4"/></svg>',
          onClick: () => self.transitionWorkRequest(wr.id)
        });
      }

      if (canEdit && !wr.isPendingApproval) {
        items.push({
          label: 'Edit',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
          onClick: () => { location.hash = '#operations/form/' + wr.id; }
        });
      }

      if (Auth.isManagerial() && wr.status !== 'Completed' && wr.status !== 'Cancelled') {
        items.push({
          label: 'Cancel',
          className: 'danger',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
          onClick: () => self.cancelWorkRequest(wr.id)
        });
      }

      if (wr.status === 'Completed' && !wr.archived) {
        items.push({
          label: 'Archive',
          className: 'primary',
          icon: ArchivePage.icons.archive,
          onClick: () => self.archiveWorkRequest(wr.id)
        });
      }

      if (canEdit && wr.status === 'Draft' && !wr.isPendingApproval) {
        items.push({
          label: 'Delete',
          className: 'danger',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
          onClick: () => self.showConfirm('Delete Work Request', `Are you sure you want to delete "${wr.title}" and all its tasks?`, async () => {
            const myGen = Workflow._startSkipGeneration();
            App.handleRoute();
            const tasks = WorkflowData.getTasksWhere(t => t.workRequestId === wr.id);
            await Promise.all(tasks.map(t => WorkflowData.deleteTask(t.id)));
            await WorkflowData.deleteWorkRequest(wr.id);
            Workflow._clearSkipGenerationIfLatest(myGen);
            App.handleRoute();
          }, 'danger')
        });
      }

      return items;
    };

    const handleBoardDrop = ({ item, targetStatus, newOrder }) => {
      const wr = item;
      const isPhaseChange = wr.status !== targetStatus;
      if (isPhaseChange && !canApprove) {
        self.showMessage('Permission Denied', 'Only Admin can route work request phases.', 'danger');
        return;
      }

      const applyMove = async () => {
        const changes = { boardOrder: newOrder };
        if (isPhaseChange) {
          changes.status = targetStatus;
          changes.updatedAt = new Date().toISOString();
        }
        const myGen = Workflow._startSkipGeneration();
        App.handleRoute();
        await WorkflowData.updateWorkRequest(wr.id, changes);
        Workflow._clearSkipGenerationIfLatest(myGen);
        App.handleRoute();
      };

      if (!isPhaseChange) {
        applyMove();
        return;
      }

      const targetPhaseLabel = boardPhases.find(p => p.targetStatus === targetStatus)?.label || targetStatus;

      const transitionStatus = self.getPhaseTransitionStatus(wr.id);
      if (!transitionStatus || transitionStatus.nextPhase !== targetStatus || !transitionStatus.canTransition) {
        const blockers = transitionStatus?.missing?.length
          ? transitionStatus.missing
          : [`This Work Request cannot be routed to "${targetPhaseLabel}" yet.`];
        self.showRoutingBlocker('Routing Blocked', blockers, { wrId: wr.id });
        return;
      }

      self.showConfirm('Confirm Move', `Move "${wr.title}" to ${boardPhases.find(p => p.targetStatus === targetStatus)?.label || targetStatus}?`, applyMove, 'success');
    };

    const dragConfig = {
      enabled: true,
      canDrag: (item) => canApprove && !item.isOptimistic,
      canDrop: ({ item, targetStatus, beforeItem, afterItem }) => {
        if (item.isOptimistic || beforeItem?.isOptimistic || afterItem?.isOptimistic) return false;
        if (item.status === targetStatus) return true;
        const currentPhaseIdx = boardPhases.findIndex(p => p.statuses.includes(item.status));
        const targetPhaseIdx = boardPhases.findIndex(p => p.targetStatus === targetStatus);
        if (currentPhaseIdx === -1 || targetPhaseIdx === -1) return false;
        // Silently reject backward moves so cards return to their original position.
        return targetPhaseIdx > currentPhaseIdx;
      },
      orderField: 'boardOrder',
      onDrop: handleBoardDrop
    };

    if (groupBy === 'none') {
      // Normalize per-column board orders so cards render consistently and gaps
      // from deleted/moved cards do not break drop midpoint calculations.
      toolbarContainer?.classList.remove('grouped-board-active');
      const sortedWrs = [];
      boardPhases.forEach(phase => {
        const phaseWrs = wrs.filter(wr => phase.statuses.includes(wr.status));
        phaseWrs.sort((a, b) => {
          const oa = typeof a.boardOrder === 'number' ? a.boardOrder : null;
          const ob = typeof b.boardOrder === 'number' ? b.boardOrder : null;
          if (oa !== null && ob !== null && oa !== ob) return oa - ob;
          if (oa !== null && ob === null) return -1;
          if (oa === null && ob !== null) return 1;
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        });
        phaseWrs.forEach((wr, idx) => {
          const newOrder = (idx + 1) * 1000;
          if (wr.boardOrder !== newOrder) {
            // boardOrder is frontend-only and is not persisted by the backend.
            // Normalize it locally to keep drop midpoint math stable without firing
            // a PUT for every card on each refresh.
            wr.boardOrder = newOrder;
          }
        });
        sortedWrs.push(...phaseWrs);
      });

      KanbanBoard.render({
        container,
        items: sortedWrs,
        columns: boardPhases.map(phase => {
          const isDraft = phase.key === 'draft';
          const col = {
            ...phase,
            icon: 'phase',
            emptyState: { variant: 'compact', title: 'No work requests', body: '' }
          };
          if (isDraft && canEdit) {
            col.addButton = { label: 'Add Work Request', onClick: openNewWrForm };
          }
          return col;
        }),
        renderCard: renderBoardCard,
        cardMenuItems: renderCardMenuItems,
        drag: dragConfig
      });
    } else {
      // Grouped board: extend the toolbar background through its bottom margin
      // so cards cannot be seen through the gap while scrolling.
      toolbarContainer?.classList.add('grouped-board-active');
      // Grouped board: stacked swimlanes. Each group is a collapsible row with a
      // sticky header that shows the group title and the phase column headings;
      // deeper headers naturally replace earlier sticky ones as the user scrolls.
      const getGroupName = (wr) => {
        if (groupBy === 'assignee') {
          const names = this.getWorkRequestAssigneeNames(wr);
          if (names.size === 0) return 'Unassigned';
          return Array.from(names).sort().join(', ');
        }
        if (groupBy === 'client') {
          const client = window.apiClient.clientCache.getById(wr.clientId);
          return client?.name || 'No Client';
        }
        if (groupBy === 'priority') {
          const p = (wr.priority || '').toString().trim().toLowerCase();
          if (p.includes('urg') || p.includes('high')) return 'Urgent';
          if (p.includes('low')) return 'Low';
          return 'Priority';
        }
        return 'All';
      };

      const groupMap = new Map();
      wrs.forEach(wr => {
        const name = getGroupName(wr);
        if (!groupMap.has(name)) groupMap.set(name, []);
        groupMap.get(name).push(wr);
      });

      const specialLast = groupBy === 'assignee' ? 'Unassigned' : groupBy === 'client' ? 'No Client' : null;
      const groupNames = Array.from(groupMap.keys()).sort((a, b) => {
        if (specialLast && a === specialLast) return 1;
        if (specialLast && b === specialLast) return -1;
        if (groupBy === 'priority') {
          const order = { 'Urgent': 0, 'Priority': 1, 'Low': 2 };
          return (order[a] ?? 99) - (order[b] ?? 99);
        }
        return a.localeCompare(b);
      });

      // Normalize boardOrder within each group-phase so midpoint drops stay clean.
      groupNames.forEach(name => {
        const groupWrs = groupMap.get(name);
        boardPhases.forEach(phase => {
          const phaseWrs = groupWrs.filter(wr => phase.statuses.includes(wr.status));
          phaseWrs.sort((a, b) => {
            const oa = typeof a.boardOrder === 'number' ? a.boardOrder : null;
            const ob = typeof b.boardOrder === 'number' ? b.boardOrder : null;
            if (oa !== null && ob !== null && oa !== ob) return oa - ob;
            if (oa !== null && ob === null) return -1;
            if (oa === null && ob !== null) return 1;
            return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
          });
          phaseWrs.forEach((wr, idx) => {
            const newOrder = (idx + 1) * 1000;
            if (wr.boardOrder !== newOrder) {
              // boardOrder is frontend-only and is not persisted by the backend.
              // Normalize it locally to keep drop midpoint math stable without firing
              // a PUT for every card on each refresh.
              wr.boardOrder = newOrder;
            }
          });
        });
      });

      const COLLAPSED_KEY = 'erp_operations_collapsed_groups';
      const getCollapsedSet = () => {
        try {
          const raw = JSON.parse(sessionStorage.getItem(COLLAPSED_KEY) || '[]');
          return new Set(Array.isArray(raw) ? raw : []);
        } catch (e) { return new Set(); }
      };
      const saveCollapsedSet = (set) => {
        try { sessionStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set])); } catch (e) { /* ignore */ }
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
        const groupWrs = groupMap.get(name);
        const sectionKey = `group-${groupBy}-${name}`;
        const collapsedSet = getCollapsedSet();
        const isCollapsed = collapsedSet.has(sectionKey);

        const section = el('div', { class: 'board-group-section' + (isCollapsed ? ' collapsed' : '') });
        section.style.setProperty('--phase-count', String(boardPhases.length));

        // Group title row (full-width, sticky)
        const titleRow = el('div', { class: 'board-group-title-row' });
        const titleCell = el('div', { class: 'board-group-title' });
        const chevronBtn = el('button', {
          type: 'button',
          class: 'board-group-collapse',
          html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
        });
        let displayName = name;
        let avatar;
        if (groupBy === 'assignee') {
          const assigneeNames = name === 'Unassigned' ? [] : name.split(', ').filter(Boolean);
          avatar = el('div', { class: 'board-group-avatars' });
          if (assigneeNames.length === 0) {
            const emptyAv = el('div', { class: 'board-group-avatar' });
            emptyAv.textContent = '—';
            emptyAv.style.backgroundColor = groupColor(displayName);
            emptyAv.style.color = '#fff';
            avatar.appendChild(emptyAv);
          } else {
            assigneeNames.slice(0, 5).forEach((assigneeName) => {
              const user = (window.apiClient.userCache._users || []).filter(u => u.name === assigneeName)[0];
              const av = el('div', { class: 'avatar-xs', title: assigneeName });
              av.style.backgroundColor = groupColor(assigneeName);
              av.style.color = '#fff';
              if (user?.avatarUrl) {
                av.style.backgroundImage = "url('" + user.avatarUrl + "')";
              } else {
                av.textContent = getInitials(assigneeName);
              }
              avatar.appendChild(av);
            });
            if (assigneeNames.length > 5) {
              const overflow = el('div', {
                class: 'avatar-xs board-group-avatar-overflow',
                text: '+' + (assigneeNames.length - 5),
                title: assigneeNames.slice(5).join(', ')
              });
              avatar.appendChild(overflow);
            }
          }
        } else {
          avatar = el('div', { class: 'board-group-avatar' });
          if (groupBy === 'client') {
            const client = (window.apiClient.clientCache._clients || []).filter(c => c.name === name)[0];
            displayName = client?.name || name;
          }
          avatar.textContent = getInitials(displayName);
          avatar.style.backgroundColor = groupColor(displayName);
          avatar.style.color = '#fff';
        }

        const nameWrap = el('div', { class: 'board-group-name-wrap' });
        const nameLine = el('div', { class: 'board-group-name' });
        nameLine.appendChild(document.createTextNode(displayName + ' '));
        nameLine.appendChild(el('span', {
          class: 'board-group-count',
          text: '(' + groupWrs.length + ' item' + (groupWrs.length === 1 ? '' : 's') + ')'
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

        // Phase heading row (sits beneath the group title inside a single sticky wrapper)
        const phaseRow = el('div', { class: 'board-group-phase-row' });
        phaseRow.style.setProperty('--phase-count', String(boardPhases.length));
        boardPhases.forEach(phase => {
          const count = groupWrs.filter(wr => phase.statuses.includes(wr.status)).length;
          const cell = el('div', { class: 'board-group-phase-header' });
          cell.style.setProperty('--phase-color', phase.color);
          cell.appendChild(el('div', { class: 'phase-header-top' }));
          const headerBody = el('div', { class: 'phase-header-body' });
          headerBody.appendChild(el('span', { class: 'board-column-dot', html: buildColumnStatusIcon({ key: phase.key, color: phase.color, icon: 'phase' }) }));
          headerBody.appendChild(el('span', { class: 'phase-header-label', text: phase.label.toUpperCase() }));
          headerBody.appendChild(el('span', { class: 'phase-header-count', text: count + ' OF ' + groupWrs.length }));
          cell.appendChild(headerBody);
          phaseRow.appendChild(cell);
        });

        const stickyWrap = el('div', { class: 'board-group-sticky-wrap' });
        stickyWrap.appendChild(titleRow);
        stickyWrap.appendChild(phaseRow);
        section.appendChild(stickyWrap);

        // Card columns
        const body = el('div', { class: 'board-group-body' });
        body.style.setProperty('--phase-count', String(boardPhases.length));
        boardPhases.forEach(phase => {
          const col = el('div', { class: 'board-group-column', 'data-target-status': phase.targetStatus });
          col.style.setProperty('--column-phase-color', phase.color);
          const phaseWrs = groupWrs.filter(wr => phase.statuses.includes(wr.status));
          if (phaseWrs.length === 0) {
            col.appendChild(renderEmptyStateV2({ variant: 'compact', title: 'No ' + phase.label.toLowerCase(), body: '' }));
          } else {
            phaseWrs.forEach(wr => {
              const card = renderBoardCard(wr, phase);
              card.dataset.itemId = wr.id;
              const items = renderCardMenuItems(wr);
              if (items.length > 0) KanbanBoard.attachCardMenu(card, items);
              col.appendChild(card);
            });
          }
          body.appendChild(col);
        });
        section.appendChild(body);
        groupedBoard.appendChild(section);
      });

      container.appendChild(groupedBoard);

      // Enable drag-and-drop for grouped board columns using the same rules as ungrouped.
      KanbanBoard.attachDrag({
        root: groupedBoard,
        items: wrs,
        drag: dragConfig
      });
    }
  },

  refreshListCompact(container, wrs, hasActiveFilters = false) {
    const canEdit = Auth.can('workflow:edit');
    const canApprove = Auth.can('workflow:approve');
    if (wrs.length === 0) {
      const entity = Auth.activeEntity;
      const allWrs = WorkflowData.getWorkRequestsWhere(r => {
        const matchesEntity = (entity === 'ALL' ? Auth.user.entities.includes(r.entity) : r.entity === entity);
        return matchesEntity && !r.archived && r.status !== 'Cancelled';
      });
      const savedHasFilters = App.hasSavedFilters('operations');
      hasActiveFilters = hasActiveFilters || savedHasFilters;
      const hasWorkRequests = allWrs.length > 0;

      if (hasWorkRequests && hasActiveFilters) {
        container.appendChild(renderFilterEmptyState(
          'No work requests match your filters',
          null,
          [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: () => { App.clearSavedFilters('operations'); App.handleRoute(); } }]
        ));
      } else {
        const actions = [];
        if (canEdit) {
          actions.push({
            text: '+ Add Work Request',
            className: 'btn btn-primary btn-sm',
            onClick: () => {
              this.editingId = null;
        this.openWorkRequestForm();
            }
          });
        }
        container.appendChild(renderEmptyStateV2({
          variant: 'zero-state',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>',
          title: hasWorkRequests ? 'No work requests in this view' : 'No work requests yet',
          body: hasWorkRequests
            ? 'Work requests are hidden by the current filters or status settings.'
            : 'Create your first work request to start tracking client work.',
          actions
        }));
      }
      return;
    }
    const list = el('div', { class: 'list-view operations-list-view' });
    wrs.forEach(wr => {
      const client = window.apiClient.clientCache.getById(wr.clientId);
      const row = el('div', { class: 'list-item' });
      const textCol = el('div');
      
      const titleDiv = el('div', { class: 'list-item-title', text: wr.title });
      if (wr.isPendingApproval) {
        titleDiv.appendChild(el('span', {
          text: 'Awaiting Approval',
          style: 'font-size: 10px; border-radius: 12px; display: inline-block; padding: 1px 4px; background: var(--color-bg-muted); color: var(--color-warning); font-weight: 600; border: 1px solid var(--color-warning); margin-left: 8px; vertical-align: middle;'
        }));
      }
      textCol.appendChild(titleDiv);
      
      textCol.appendChild(el('div', { class: 'list-item-meta', text: (client?.name || '—') + ' | Due: ' + (wr.dueDate ? formatDate(wr.dueDate) : '—') }));
      
      const badgeRow = el('div', { style: 'display: flex; gap: 6px; margin-top: 4px;' });
      badgeRow.appendChild(this.getPriorityBadgeForWr(wr));
      badgeRow.appendChild(this.getFinanceBadgeForWr(wr));
      badgeRow.appendChild(this.getDocBadgeForWr(wr));
      textCol.appendChild(badgeRow);
      
      row.appendChild(textCol);
      
      if (wr.isPendingApproval) {
        row.appendChild(el('span', {
          text: 'Awaiting Approval',
          style: 'background: var(--color-bg-muted); color: var(--color-warning); font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 12px; align-self: center;'
        }));
      } else {
        row.appendChild(this.statusBadge(wr.status));
      }
      
      if (!wr.isPendingApproval) {
        if (canApprove && wr.status !== 'Completed' && wr.status !== 'Cancelled') {
          const ts = this.getPhaseTransitionStatus(wr.id);
          if (ts && ts.canTransition && ts.nextPhase) {
            const readyBadge = el('span', {
              html: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg> Ready to route',
              style: 'color:var(--color-success);font-size:10px;display:inline-flex;align-items:center;gap:3px;padding:2px 8px;background:rgba(52, 211, 153, 0.12);border-radius: 12px;font-weight:500;cursor:pointer;'
            });
            readyBadge.addEventListener('click', (e) => {
              e.stopPropagation();
              this.transitionWorkRequest(wr.id);
            });
            row.appendChild(readyBadge);
          } else if (ts && ts.missing && ts.missing.length > 0) {
            const blockerChip = el('span', {
              html: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg> ' + ts.missing.length + ' pending',
              style: 'color:var(--color-warning);font-size:10px;display:inline-flex;align-items:center;gap:3px;padding:2px 8px;background:rgba(251, 191, 36, 0.12);border-radius: 12px;cursor:help;font-weight:500;'
            });
            blockerChip.title = ts.missing.join('\n');
            row.appendChild(blockerChip);
          }
        }
      } else if (Auth.user.id === wr.submittedBy || Auth.isManagerial()) {
        const cancelBtn = el('button', {
          class: 'btn btn-danger btn-sm',
          html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px; vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Cancel',
          style: 'align-self: center; margin-left: 8px;'
        });
        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          Workflow.showConfirm('Confirm Cancellation', 'Are you sure you want to cancel and withdraw this request?', () => {
            PendingChanges.delete(wr.pendingChangeId);
            App.handleRoute();
          }, 'danger');
        });
        row.appendChild(cancelBtn);
      }
      row.addEventListener('click', () => { this._navigateToWrDetail(wr.id); });
      list.appendChild(row);
    });
    container.appendChild(list);
  },

  async showTaskSidePane(taskId, triggerElement) {
    let task = WorkflowData.getTaskById(taskId);
    let pendingWr = null;
    if (!task) {
      await WorkflowData.loadPendingApprovals();
      const pendingChanges = WorkflowData.getPendingApprovalsWhere(pc => pc.status === 'pending' && pc.table === 'workRequests');
      for (const pc of pendingChanges) {
        const t = (pc.proposedData.tasks || []).find(tk => tk.id === taskId || tk.key === taskId);
        if (t) {
          task = t;
          pendingWr = { ...pc.proposedData };
          pendingWr.id = pc.proposedData.id || pc.id;
          pendingWr.isPendingApproval = true;
          pendingWr.pendingChangeId = pc.id;
          pendingWr.submittedBy = pc.submittedBy;
          pendingWr.status = 'Draft';
          break;
        }
      }
    }
    if (!task) return;
    this.ensureTaskChecklistNormalized(task);

    let wrDocs = [];
    const wr = pendingWr || (task.workRequestId ? WorkflowData.getWorkRequestById(task.workRequestId) : null);
    if (wr?.id) {
      try {
        const docsRes = await window.apiClient.documents.list({ workRequestId: wr.id });
        wrDocs = docsRes?.data || [];
      } catch (e) {
        console.error('[Workflow] failed to load DMS documents for task side pane', e);
      }
    }

    const assignedUser = task.assignedTo || task.assigneeId ? window.apiClient.userCache.getById(task.assignedTo || task.assigneeId) : null;

    const paneContent = el('div');

    // Title Section
    const titleSec = el('div', { class: 'side-pane-title-section' });
    titleSec.appendChild(el('div', { class: 'side-pane-icon', text: '📝' }));
    titleSec.appendChild(el('h2', { class: 'side-pane-title', text: task.title || 'Untitled Task' }));
    
    if (wr) {
      const openWrLink = el('button', { class: 'side-pane-view-details' });
      openWrLink.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20M4 19.5v-13A2.5 2.5 0 0 1 6.5 4H20v13H6.5a2.5 2.5 0 0 0-2.5 2.5z"></path></svg> Work Request: ${(wr.id || '').toString().toUpperCase()}`;
      openWrLink.addEventListener('click', () => {
        window.SidePaneInstance.close();
      });
      titleSec.appendChild(openWrLink);
    }
    paneContent.appendChild(titleSec);

    // Properties Section
    const propsSec = el('div', { class: 'side-pane-properties' });

    const propLabel = (label, svg) => {
      const lbl = el('div', { class: 'side-pane-prop-label' });
      lbl.innerHTML = `${svg}<span>${label}</span>`;
      return lbl;
    };

    const statusIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;
    const priorityIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;
    const dateIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
    const assigneeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

    // Status Row
    propsSec.appendChild(propLabel('Status', statusIcon));
    const statusValEl = el('div', { class: 'side-pane-prop-value' });
    const statusSel = el('select', { class: 'status-select form-select', style: 'padding: 2px 6px; font-size: 0.8125rem; font-weight: 600;' });
    
    const validStatuses = this.getValidNextStatuses(task);
    const flow = ['Draft', 'Assigned', 'In Progress', 'For Review', 'Completed', 'Cancelled'];
    const checklistCompletion = getTaskChecklistCompletion(task);
    const hasIncompleteChecklist = checklistCompletion.total > 0 && checklistCompletion.done < checklistCompletion.total;
    const isArchived = wr && (wr.status === 'Completed' || wr.status === 'Cancelled' || wr.isPendingApproval);
    const isDraft = wr && wr.status === 'Draft';
    const allowAssignChecklist = !wr || wr.status === 'Draft' || wr.status === 'Pre-processing';
    const allowAddRequirements = allowAssignChecklist;

    flow.forEach(s => {
      const opt = el('option', { value: s, text: s });
      if (s === task.status) opt.selected = true;
      const blockedByChecklist = hasIncompleteChecklist && (s === 'Completed' || s === 'For Review');
      const noAssignee = !(task.assigneeId || task.assignedTo || task.assigneeName);
      
      if (isArchived) {
        opt.disabled = true;
        opt.title = 'Work request is archived';
      } else if (blockedByChecklist) {
        opt.disabled = true;
        opt.title = `${checklistCompletion.total - checklistCompletion.done} of ${checklistCompletion.total} requirement items incomplete`;
      } else if (s === 'Assigned' && noAssignee) {
        opt.disabled = true;
        opt.title = 'Assign an employee first';
      } else if (!validStatuses.includes(s)) {
        opt.disabled = true;
        opt.title = `Cannot change to ${s}`;
      }
      statusSel.appendChild(opt);
    });
    if (!disableIfPending(statusSel, wr)) {
      if (isArchived) statusSel.disabled = true;
    }

    // Status text colors chosen to stay discernible in both light and dark surfaces.
    const sColors = { 'Completed': '#22c55e', 'In Progress': '#f59e0b', 'Draft': '#94a3b8', 'For Review': '#3b82f6', 'Assigned': '#3b82f6', 'Cancelled': '#ef4444' };
    statusSel.style.color = sColors[task.status] || 'var(--fg)';

    statusSel.addEventListener('change', () => {
      const newStatus = statusSel.value;
      const originalStatus = task.status;
      const resetDropdown = () => {
        statusSel.value = originalStatus;
        statusSel.style.color = sColors[originalStatus] || 'var(--fg)';
      };

      if (newStatus === 'Completed' || newStatus === 'Cancelled') {
        this.showConfirm('Confirm Status Change',
          `Are you sure you want to mark this task as "${newStatus}"? This may affect dependencies and routing.`,
          () => {
            const res = this.updateTaskStatus(task.id, newStatus);
            if (res.error) {
              this.showMessage('Error', res.error, 'danger');
              resetDropdown();
            } else {
              this.showTaskSidePane(taskId, triggerElement);
              App.handleRoute(); // Refresh background
            }
          },
          newStatus === 'Cancelled' ? 'danger' : 'warning',
          resetDropdown
        );
      } else {
        const res = this.updateTaskStatus(task.id, newStatus);
        if (res.error) {
          this.showMessage('Error', res.error, 'danger');
          resetDropdown();
        } else {
          this.showTaskSidePane(taskId, triggerElement);
          App.handleRoute(); // Refresh background
        }
      }
    });
    statusValEl.appendChild(statusSel);
    propsSec.appendChild(statusValEl);

    // Priority Row
    propsSec.appendChild(propLabel('Priority', priorityIcon));
    const priorityClass = { 'Urgent': 'badge-danger', 'Priority': 'badge-warn', 'Low Priority': 'badge-info' }[task.priority] || 'badge-muted';
    propsSec.appendChild(el('div', { class: 'side-pane-prop-value' }, [
      el('span', { class: `badge ${priorityClass}`, text: task.priority || 'Normal' })
    ]));

    // Due Date Row
    propsSec.appendChild(propLabel('Due Date', dateIcon));
    propsSec.appendChild(el('div', { class: 'side-pane-prop-value' }, [
      el('span', { text: task.dueDate ? formatDate(task.dueDate) : '—' })
    ]));

    // Assignee Row
    propsSec.appendChild(propLabel('Assignee', assigneeIcon));
    const assigneeValEl = el('div', { class: 'side-pane-prop-value', style: 'display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; width: 100%; align-items: flex-start;' });

    if (wr && wr.status === 'Draft' && !wr.isPendingApproval) {
      // Editable mode: dropdown for primary assignee + co-assignee picker
      const gwDropdown = await this.createGroundWorkerDropdown({
        selectedGroundWorkerName: task.assigneeName || '',
        placeholder: 'Assign primary employee...',
        className: 'side-pane-primary-assignee-dropdown',
        onChange: ({ assigneeId, assigneeName }) => {
          WorkflowData.updateTask(task.id, {
            assigneeId: assigneeId || null,
            assigneeName: assigneeName || null,
            status: assigneeName ? 'Assigned' : 'Draft',
            updatedAt: new Date().toISOString()
          });
          this.showTaskSidePane(task.id, triggerElement);
          App.handleRoute();
        }
      });
      assigneeValEl.appendChild(gwDropdown);

      const coPicker = await this.renderTaskCoAssigneePicker(
        task,
        { primaryName: task.assigneeName || '', className: 'side-pane-coassignee-dropdown' },
        true,
        true,
        () => {
          this.showTaskSidePane(task.id, triggerElement);
        }
      );
      assigneeValEl.appendChild(coPicker);
    } else {
      // Read-only mode: display standard stacked avatars list
      const names = getTaskAllAssigneeNames(task);
      assigneeValEl.appendChild(this.renderAssigneeAvatarsList(names));
    }
    propsSec.appendChild(assigneeValEl);

    paneContent.appendChild(propsSec);

    // Accordion helper function
    const createCollapsibleSection = (title, defaultExpanded, renderContentFn) => {
      const header = el('div', { class: 'side-pane-toggle-header' + (defaultExpanded ? '' : ' collapsed'), text: title });
      const content = el('div', { class: 'side-pane-toggle-content' + (defaultExpanded ? '' : ' collapsed') });
      
      header.addEventListener('click', () => {
        header.classList.toggle('collapsed');
        content.classList.toggle('collapsed');
      });
      
      renderContentFn(content);
      return [header, content];
    };

    // 1. Task Description Section (Non-collapsible)
    const descSection = el('div', { class: 'side-pane-section' });
    descSection.appendChild(el('h3', { class: 'side-pane-section-title', text: 'Task description' }));
    descSection.appendChild(el('div', { class: 'side-pane-description', text: task.description || 'Provide an overview of the task and related details.' }));
    paneContent.appendChild(descSection);

    const [checklistHeaderToggle, checklistContentToggle] = createCollapsibleSection('Sub-tasks / Requirements Checklist', true, async (cont) => {
      const listContainer = el('div', { class: 'details-content-list' });
      let populatePrereqSelect = () => {};
      
      const normalizedChecklist = task.checklist || [];

      const renderChecklist = async () => {
        listContainer.innerHTML = '';
        if (normalizedChecklist.length === 0) {
          listContainer.appendChild(renderEmptyState('No checklist items'));
        } else {
          for (const [idx, item] of normalizedChecklist.entries()) {
            const blocked = isChecklistBlocked(item, normalizedChecklist);
            const prereq = item.dependsOn === '*' ? null : normalizedChecklist.find(c => c.id === item.dependsOn);
            const row = el('div', { class: classNames('checklist-item', blocked && 'locked', this.getCompletedClass(item)) });

            const cb = el('input', { type: 'checkbox' });
            cb.checked = !!item.completed;
            if (!disableIfPending(cb, wr)) {
              cb.disabled = blocked;
              if (blocked) cb.title = 'Locked';
            }

            if (!wr || !wr.isPendingApproval) {
              cb.addEventListener('change', () => {
                this.toggleChecklistItem(task, item.id, cb.checked);
                this.showTaskSidePane(taskId, triggerElement);
                App.handleRoute(); // Refresh background
              });
            }

            const textValue = blocked ? ('🔒 Waiting for: ' + (item.dependsOn === '*' ? 'All Task (*)' : (prereq ? prereq.text : 'Unknown'))) : item.text;
            const textWrap = el('div', { class: 'checklist-text' });
            textWrap.appendChild(el('span', { text: textValue, class: classNames(this.getCompletedClass(item)), title: textValue }));
            const categoryBadge = el('span', {
              text: item.category === 'document' ? 'Document' : 'Sub-task',
              class: 'checklist-category-badge',
              style: 'font-size:0.65rem; padding:1px 5px; border-radius: 12px; background:' + (item.category === 'document' ? '#dbeafe' : '#f3f4f6') + '; color:' + (item.category === 'document' ? '#1e40af' : '#4b5563') + '; font-weight:600; margin-left:6px;'
            });
            textWrap.appendChild(categoryBadge);
            row.appendChild(cb);
            row.appendChild(textWrap);

            if (allowAssignChecklist) {
              const assigneeWrap = el('div', { class: 'task-assignee-wrapper' });
              const assigneeDropdown = await this.createGroundWorkerDropdown({
                selectedGroundWorkerName: item.assigneeName,
                placeholder: 'Assign...',
                className: 'checklist-assignee-dropdown',
                priorityNames: getTaskAllAssigneeNames(task),
                onChange: ({ assigneeId, assigneeName }) => {
                  item.assigneeName = assigneeName || null;
                  item.assigneeId = assigneeId || null;
                  WorkflowData.updateTask(task.id, { checklist: normalizedChecklist, updatedAt: new Date().toISOString() });
                  this.showTaskSidePane(taskId, triggerElement);
                  App.handleRoute();
                }
              });
              if (isPendingWr(wr)) {
                const input = assigneeDropdown.querySelector('input');
                if (input) disableForApproval(input);
                disableForApproval(assigneeDropdown);
              }
              assigneeWrap.appendChild(assigneeDropdown);

              const coAssigneePicker = await this.renderChecklistCoAssigneePicker(
                task,
                item,
                { primaryName: item.assigneeName || '', className: 'inline-coassignee-dropdown' },
                !isArchived,
                true,
                () => {
                  WorkflowData.updateTask(task.id, { checklist: normalizedChecklist, updatedAt: new Date().toISOString() });
                  this.showTaskSidePane(taskId, triggerElement);
                  App.handleRoute();
                }
              );
              assigneeWrap.appendChild(coAssigneePicker);
              row.appendChild(assigneeWrap);
            } else {
              const itemAssigneeNames = [];
              if (item.assigneeName) {
                itemAssigneeNames.push(item.assigneeName);
              }
              if (item.coAssignees && Array.isArray(item.coAssignees)) {
                item.coAssignees.forEach(name => {
                  if (name && !itemAssigneeNames.includes(name)) {
                    itemAssigneeNames.push(name);
                  }
                });
              }
              const assigneeWrap = this.renderAssigneeAvatarsList(itemAssigneeNames);
              row.appendChild(assigneeWrap);
            }

            const itemHours = getChecklistItemTotalHours(item);
            const timePill = el('span', { class: 'hours-pill', text: itemHours + 'h' });
            row.appendChild(timePill);

            const actionsDiv = el('div', { style: 'display:flex; gap: 4px;' });
            const logBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-xs', text: 'Log' });
            if (!disableIfPending(logBtn, wr)) {
              logBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showAddTimeLogModal(task.id, item.id);
              });
            }
            actionsDiv.appendChild(logBtn);

            const delBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-xs', text: '×', style: 'color:var(--color-text-muted); font-size: 14px;' });
            if (!disableIfPending(delBtn, wr)) {
              delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!item.timeLogs || item.timeLogs.length === 0) {
                  normalizedChecklist.splice(idx, 1);
                  WorkflowData.updateTask(task.id, { checklist: normalizedChecklist, updatedAt: new Date().toISOString() });
                  this.showTaskSidePane(taskId, triggerElement);
                  App.handleRoute();
                } else {
                  const content = el('div');
                  content.appendChild(el('p', { text: `This item has ${item.timeLogs.length} logged time record(s). Choose how to proceed:` }));
                  const actions = el('div', { class: 'checklist-delete-modal-actions', style: 'display:flex; gap:8px; margin-top:12px;' });
                  const reassignBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Reassign to task' });
                  const deleteAllBtn = el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Delete logs & item' });
                  actions.appendChild(reassignBtn);
                  actions.appendChild(deleteAllBtn);
                  content.appendChild(actions);

                  const overlay = this.showModal('Delete Checklist Item', content, null);

                  reassignBtn.addEventListener('click', () => {
                    overlay.remove();
                    const tObj = WorkflowData.getTaskById(task.id) || task;
                    const logsToMove = (item.timeLogs || []).map(l => ({ ...l, checklistItemId: null }));
                    tObj.timeLogs = [...(tObj.timeLogs || []), ...logsToMove];
                    tObj.checklist = (tObj.checklist || []).filter(c => c.id !== item.id);
                    WorkflowData.updateTask(tObj.id, { checklist: tObj.checklist, timeLogs: tObj.timeLogs, updatedAt: new Date().toISOString() });
                    this.showTaskSidePane(taskId, triggerElement);
                    App.handleRoute();
                  });

                  deleteAllBtn.addEventListener('click', () => {
                    overlay.remove();
                    const tObj = WorkflowData.getTaskById(task.id) || task;
                    tObj.checklist = (tObj.checklist || []).filter(c => c.id !== item.id);
                    WorkflowData.updateTask(tObj.id, { checklist: tObj.checklist, updatedAt: new Date().toISOString() });
                    this.showTaskSidePane(taskId, triggerElement);
                    App.handleRoute();
                  });
                }
              });
            }
            actionsDiv.appendChild(delBtn);
            row.appendChild(actionsDiv);

            listContainer.appendChild(row);
          }
        }
      };

      cont.appendChild(listContainer);

      if (allowAddRequirements) {
        const addChecklistRow = el('div', { class: 'add-checklist', style: 'margin-top: 12px; display: flex; gap: 8px; align-items: center;' });
        const newItemInput = el('input', { type: 'text', placeholder: 'Add sub-task...', class: 'form-control', style: 'flex: 1;' });

        // Category selector for new checklist items
        const categorySel = el('select', { class: 'form-select', style: 'width: 110px; flex-shrink: 0;' });
        categorySel.appendChild(el('option', { value: 'subtask', text: 'Sub-task' }));
        categorySel.appendChild(el('option', { value: 'document', text: 'Document' }));

        // Custom single-select styled as dependency selector
        const predWrapper = el('div', { class: 'multi-select-dropdown', style: 'width: 160px;' });
        const predBtn = el('button', { type: 'button', class: 'multi-select-btn', text: '— Dependency —', style: 'width: 100%; height: 32px;' });
        const predMenu = el('div', { class: 'multi-select-menu', style: 'width: 100%;' });
        predWrapper.appendChild(predBtn);
        predWrapper.appendChild(predMenu);

        let selectedPrereqId = null;

        populatePrereqSelect = () => {
          predMenu.innerHTML = '';
          
          // Option for None
          const noneOption = el('label', { class: 'multi-select-option' });
          const noneCheckbox = el('input', { type: 'checkbox', value: '' });
          if (!selectedPrereqId) noneCheckbox.checked = true;
          noneCheckbox.addEventListener('change', () => {
            selectedPrereqId = null;
            predBtn.textContent = '— Dependency —';
            predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
              if (input !== noneCheckbox) input.checked = false;
            });
            predMenu.classList.remove('show');
          });
          noneOption.appendChild(noneCheckbox);
          noneOption.appendChild(document.createTextNode('— Dependency —'));
          predMenu.appendChild(noneOption);

          // Option for All Task (*)
          const allOption = el('label', { class: 'multi-select-option' });
          const allCheckbox = el('input', { type: 'checkbox', value: '*' });
          if (selectedPrereqId === '*') allCheckbox.checked = true;
          allCheckbox.addEventListener('change', () => {
            if (allCheckbox.checked) {
              selectedPrereqId = '*';
              predBtn.textContent = 'All Task (*)';
              predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
                if (input !== allCheckbox) input.checked = false;
              });
            } else {
              selectedPrereqId = null;
              predBtn.textContent = '— Dependency —';
            }
            predMenu.classList.remove('show');
          });
          allOption.appendChild(allCheckbox);
          allOption.appendChild(document.createTextNode('All Task (*)'));
          predMenu.appendChild(allOption);

          normalizedChecklist.forEach(item => {
            const option = el('label', { class: 'multi-select-option' });
            const checkbox = el('input', { type: 'checkbox', value: item.id });
            if (selectedPrereqId === item.id) checkbox.checked = true;
            checkbox.addEventListener('change', () => {
              if (checkbox.checked) {
                selectedPrereqId = item.id;
                predBtn.textContent = item.text;
                predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
                  if (input !== checkbox) input.checked = false;
                });
              } else {
                selectedPrereqId = null;
                predBtn.textContent = '— Dependency —';
              }
              predMenu.classList.remove('show');
            });
            option.appendChild(checkbox);
            option.appendChild(document.createTextNode(item.text));
            predMenu.appendChild(option);
          });
        };
        populatePrereqSelect();

        const addItemBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Add' });

        if (wr && wr.isPendingApproval) {
          disableForApproval(newItemInput);
          disableForApproval(categorySel);
          disableForApproval(predBtn);
          disableForApproval(addItemBtn);
        } else {
          predBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.multi-select-menu.show').forEach(m => {
              if (m !== predMenu) m.classList.remove('show');
            });
            predMenu.classList.toggle('show');
          });
          predMenu.addEventListener('click', (e) => e.stopPropagation());

          addItemBtn.addEventListener('click', () => {
            const val = newItemInput.value.trim();
            if (!val) return;
            const prereqId = selectedPrereqId || null;
            normalizedChecklist.push({ id: generateUUID(), text: val, category: categorySel.value || 'subtask', completed: false, assigneeId: null, assigneeName: null, dependsOn: prereqId, timeLogs: [] });
            WorkflowData.updateTask(task.id, { checklist: normalizedChecklist, updatedAt: new Date().toISOString() });
            this.showTaskSidePane(taskId, triggerElement);
            App.handleRoute();
          });
        }

        addChecklistRow.appendChild(newItemInput);
        addChecklistRow.appendChild(categorySel);
        addChecklistRow.appendChild(predWrapper);
        addChecklistRow.appendChild(addItemBtn);
        cont.appendChild(addChecklistRow);
      }

      await renderChecklist();
    });
    paneContent.appendChild(checklistHeaderToggle);
    paneContent.appendChild(checklistContentToggle);

    // 3. Supporting Files / Documents Collapsible Section
    const [docsHeaderToggle, docsContentToggle] = createCollapsibleSection('Supporting Files', false, (cont) => {
      const docHeaderActions = el('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' });
      const docCount = (task.taskDocuments || []).length;
      docHeaderActions.appendChild(el('span', { text: `${docCount} attached files`, style: 'font-size: 0.8125rem; color: var(--color-text-muted);' }));
      
      const isDocStaff = Auth.user?.name?.toLowerCase().includes('documentation') ||
                         Auth.user?.email?.toLowerCase().startsWith('docs@');
      const isArchived = wr && (wr.status === 'Completed' || wr.status === 'Cancelled' || wr.isPendingApproval);

      if (isDocStaff && !isArchived) {
        const addDocBtn = el('button', { class: 'btn btn-primary btn-xs', text: '+ Upload File' });
        addDocBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showAddDocumentModal(task.id, addDocBtn);
        });
        docHeaderActions.appendChild(addDocBtn);
      }
      cont.appendChild(docHeaderActions);

      const docsList = el('div', { class: 'details-content-list' });
      if ((task.taskDocuments || []).length === 0) {
        docsList.appendChild(renderEmptyState('No documents attached', null, { style: 'margin-bottom: 8px;' }));
      } else {
        const canEditDms = Auth.can('dms:edit');
        task.taskDocuments.forEach((d, dIdx) => {
          const item = el('div', { class: 'detail-item-v2', style: 'display:flex; justify-content:space-between; align-items:center; padding: 8px 0; border-bottom: 1px solid var(--color-border);' });
          const leftSide = el('div', { style: 'display:flex; flex-direction:column; gap: 2px;' });
          const fName = d.fileName || d.filename;

          if (d.isFigma) {
            const figmaLink = el('a', {
              href: d.figmaUrl,
              target: '_blank',
              style: 'color: #a855f7; font-weight:600; text-decoration:underline; cursor:pointer; font-size: 0.8125rem; display: flex; align-items: center; gap: 6px;'
            });
            figmaLink.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #a855f7;"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H12v5H7.5A2.5 2.5 0 0 1 5 5.5z"></path><path d="M12 3h4.5A2.5 2.5 0 0 1 19 5.5 2.5 2.5 0 0 1 16.5 8H12V3z"></path><path d="M5 12.5A2.5 2.5 0 0 1 7.5 10H12v5H7.5A2.5 2.5 0 0 1 5 12.5z"></path><path d="M12 10h4.5a2.5 2.5 0 0 1 0 5H12v-5z"></path><path d="M5 19.5A2.5 2.5 0 0 1 7.5 17H12v5H7.5A2.5 2.5 0 0 1 5 19.5z"></path></svg>
              <span>${fName}</span>
            `;
            leftSide.appendChild(figmaLink);
          } else {
            const canViewDms = Auth.can('dms:view');
            if (canViewDms) {
              let dmsDoc = null;
              if (d.documentId) {
                dmsDoc = wrDocs.find(doc => doc.id === d.documentId);
              } else {
                const matches = wrDocs.filter(doc => doc.original_name === fName || doc.file_name === fName || doc.fileName === fName);
                if (matches.length === 1) {
                  dmsDoc = matches[0];
                  d.documentId = dmsDoc.id;
                }
              }

              if (dmsDoc) {
                const link = el('a', {
                  href: '#',
                  text: (d.isGoogleDrive ? '🟢 ' : '📎 ') + fName + (d.isGoogleDrive ? ' (Google Drive)' : ''),
                  style: `color:${d.isGoogleDrive ? '#22c55e' : 'var(--color-primary)'}; font-weight:600; text-decoration:underline; cursor:pointer; font-size: 0.8125rem;`
                });
                link.addEventListener('click', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  this.showDocumentPreview(dmsDoc.id);
                });
                leftSide.appendChild(link);
              } else if (d.linkUrl) {
                const link = el('a', {
                  href: d.linkUrl,
                  target: '_blank',
                  text: (d.isGoogleDrive ? '🟢 ' : '📎 ') + fName + (d.isGoogleDrive ? ' (Google Drive)' : ''),
                  style: `color:${d.isGoogleDrive ? '#22c55e' : 'var(--color-primary)'}; font-weight:600; text-decoration:underline; cursor:pointer; font-size: 0.8125rem;`
                });
                leftSide.appendChild(link);
              } else {
                leftSide.appendChild(el('span', { text: (d.isGoogleDrive ? '🟢 ' : '📎 ') + fName + (d.isGoogleDrive ? ' (Google Drive)' : ''), style: 'font-size: 0.8125rem; font-weight: 500;' }));
              }
            } else {
              leftSide.appendChild(el('span', { text: (d.isGoogleDrive ? '🟢 ' : '📎 ') + fName + (d.isGoogleDrive ? ' (Google Drive)' : ''), style: 'font-size: 0.8125rem; font-weight: 500;' }));
            }
          }
          leftSide.appendChild(el('span', { text: `Uploaded: ${formatDate(d.uploadDate)}`, style: 'font-size: 10px; color: var(--color-text-muted);' }));
          item.appendChild(leftSide);

          if (isDocStaff || isAdmin) {
            const delBtn = el('button', { class: 'btn btn-ghost btn-xs', text: '×', style: 'color:var(--color-danger); font-size:1.2rem; padding:0 4px;' });
            if (!disableIfPending(delBtn, wr)) {
              delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showConfirm('Confirm Removal', `Are you sure you want to remove "${fName}" from this task?`, async () => {
                  const updatedTaskDocs = task.taskDocuments.filter((_, i) => i !== dIdx);
                  WorkflowData.updateTask(task.id, { taskDocuments: updatedTaskDocs });
                  const docIdToDelete = d.documentId || (wrDocs.find(doc => doc.fileName === fName && doc.workRequestId === wr.id) || {}).id;
                  if (docIdToDelete) {
                    try {
                      await window.apiClient.documents.remove(docIdToDelete);
                    } catch (err) {
                      console.error('Failed to delete DMS document', err);
                    }
                  }
                  await this.showTaskSidePane(taskId, triggerElement);
                  App.handleRoute();
                }, 'danger');
              });
            }
            item.appendChild(delBtn);
          }
          docsList.appendChild(item);
        });
      }
      cont.appendChild(docsList);

      // Notion-style Embed Options — only for roles that can upload (Admin, Manager, Operations)
      const canUploadDocs = Auth.can('workflow:edit') || Auth.can('workflow:task_upload');
      if (!isArchived && canUploadDocs) {
        const embedContainer = el('div', { class: 'embed-options', style: 'margin-top: 16px; display: flex; flex-direction: column; gap: 8px;' });
        
        // 1. Upload Document
        const pdfOpt = el('button', { class: 'notion-embed-option', type: 'button' });
        pdfOpt.innerHTML = `
          <span class="notion-embed-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #ef4444;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          </span>
          <span style="flex: 1; text-align: left;">Upload Document</span>
        `;
        pdfOpt.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showAttachmentPopover(task.id, pdfOpt, 'upload');
        });
        
        // 2. Link GDrive File
        const gdOpt = el('button', { class: 'notion-embed-option', type: 'button' });
        gdOpt.innerHTML = `
          <span class="notion-embed-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #22c55e;"><path d="M2.5 17h19M4.5 14l3.5-6h8l3.5 6M9 9h6M12 3v3"></path></svg>
          </span>
          <span style="flex: 1; text-align: left;">Link GDrive File</span>
        `;
        gdOpt.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showAttachmentPopover(task.id, gdOpt, 'gdrive');
        });

        embedContainer.appendChild(pdfOpt);
        embedContainer.appendChild(gdOpt);
        cont.appendChild(embedContainer);
      }
    });
    paneContent.appendChild(docsHeaderToggle);
    paneContent.appendChild(docsContentToggle);

    // 4. Time Log History Collapsible Section
    const [timeHeaderToggle, timeContentToggle] = createCollapsibleSection('Time Log History', false, (cont) => {
      const timeHeaderActions = el('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' });
      const totalHours = getTaskTotalHours(task);
      timeHeaderActions.appendChild(el('span', { text: `Total: ${totalHours} hrs`, style: 'font-size: 0.8125rem; color: var(--color-text-muted);' }));
      
      const isArchived = wr && (wr.status === 'Completed' || wr.status === 'Cancelled' || wr.isPendingApproval);
      if (!isArchived) {
        const logTimeBtn = el('button', { class: 'btn btn-primary btn-xs', text: '+ Log Time' });
        logTimeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showAddTimeLogModal(task.id);
        });
        timeHeaderActions.appendChild(logTimeBtn);
      }
      cont.appendChild(timeHeaderActions);

      const timeList = el('div', { class: 'details-content-list' });
      const logs = task.timeLogs || [];
      const checklistLogGroups = [];
      (task.checklist || []).forEach(item => {
        if (item.timeLogs && item.timeLogs.length > 0) checklistLogGroups.push({ item, logs: item.timeLogs });
      });

      if (logs.length === 0 && checklistLogGroups.length === 0) {
        timeList.appendChild(renderEmptyState('No logs recorded'));
      } else {
        const buildTimeLogEntry = (l, subtaskName = null) => {
          const [y, m, d] = l.date.split('-').map(Number);
          const logDate = new Date(y, m - 1, d);
          const dateStr = logDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
          const workerLabel = l.workerName || (window.apiClient.userCache.getById(l.userId)?.name || l.userId || 'Unknown');
          const noteText = l.note ? ` — ${l.note}` : '';
          const subtaskContext = subtaskName ? ` [Sub-task: ${subtaskName}]` : '';

          return el('div', { 
            class: 'history-item', 
            style: 'display: flex; justify-content: space-between; align-items: center; padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border); font-size: 0.8125rem;' 
          }, [
            el('div', {}, [
              el('strong', { text: workerLabel, style: 'color: var(--color-text);' }),
              el('span', { text: subtaskContext, style: 'color: var(--color-primary); font-size: 11px; font-weight: 600;' }),
              el('span', { text: noteText, style: 'color: var(--color-text-muted);' }),
              el('div', { class: 'history-meta', text: `${dateStr} • ${l.startTime}–${l.endTime}`, style: 'font-size: 10px; color: var(--color-text-muted);' })
            ]),
            el('span', { class: 'font-mono', text: `${l.hours}h`, style: 'font-weight: 700; color: var(--color-text);' })
          ]);
        };

        const taskLevelLogs = logs.filter(l => !l.checklistItemId);
        if (taskLevelLogs.length > 0) {
          const sorted = [...taskLevelLogs].sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
          sorted.forEach(l => {
            timeList.appendChild(buildTimeLogEntry(l));
          });
        }

        checklistLogGroups.forEach(({ item, logs: itemLogs }) => {
          const sorted = [...itemLogs].sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
          sorted.forEach(l => {
            timeList.appendChild(buildTimeLogEntry(l, item.text));
          });
        });
      }
      cont.appendChild(timeList);
    });
    paneContent.appendChild(timeHeaderToggle);
    paneContent.appendChild(timeContentToggle);

    // 5. Dependency Map Collapsible Section
    const [depHeaderToggle, depContentToggle] = createCollapsibleSection('Dependency Map', false, (cont) => {
      const depHeaderActions = el('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;' });
      depHeaderActions.appendChild(el('span', { text: 'Blocking / Pre-requisites', style: 'font-size: 0.8125rem; color: var(--color-text-muted);' }));
      
      const isArchived = wr && (wr.status === 'Completed' || wr.status === 'Cancelled' || wr.isPendingApproval);
      if (!isArchived) {
        const editDepBtn = el('button', { class: 'btn btn-secondary btn-xs', text: 'Edit Dependencies' });
        editDepBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showEditTaskModal(task.id, () => {
            this.showTaskSidePane(task.id, triggerElement);
            App.handleRoute();
          });
        });
        depHeaderActions.appendChild(editDepBtn);
      }
      cont.appendChild(depHeaderActions);

      const depList = el('div', { class: 'dep-list', style: 'display: flex; flex-direction: column; gap: 8px;' });
      const taskPreds = task.predecessors || [];
      const checklistDeps = (task.checklist || []).filter(item => item.dependsOn);

      if (taskPreds.length === 0 && checklistDeps.length === 0) {
        depList.appendChild(renderEmptyState('No dependencies'));
      } else {
        taskPreds.forEach(pid => {
          const pTask = WorkflowData.getTaskById(pid);
          const pStatus = pTask ? pTask.status : 'Unknown';
          const pStatusColors = {
            'Completed': 'var(--color-success)',
            'In Progress': 'var(--color-warning)',
            'Draft': '#6b6b6b',
            'For Review': 'var(--color-primary)',
            'Assigned': 'var(--color-primary)',
            'Cancelled': 'var(--color-danger)'
          };

          const depItem = el('div', { 
            class: 'dep-item', 
            style: 'display: flex; align-items: center; gap: 8px; font-size: 0.8125rem;' 
          });
          depItem.appendChild(el('span', { text: pTask ? pTask.title : 'Unknown', style: 'font-weight: 600;' }));
          
          const statusBadge = el('span', { 
            text: pStatus, 
            class: 'badge',
            style: `font-size: 9px; padding: 1px 6px; background-color: color-mix(in srgb, ${pStatusColors[pStatus] || '#94a3b8'}, transparent 85%); color: ${pStatusColors[pStatus] || '#475569'}; border: 1px solid color-mix(in srgb, ${pStatusColors[pStatus] || '#94a3b8'}, transparent 70%); border-radius: 12px;` 
          });
          depItem.appendChild(statusBadge);
          
          depItem.appendChild(el('span', { class: 'dep-arrow', text: '→', style: 'color: var(--color-text-muted);' }));
          depItem.appendChild(el('span', { class: 'text-muted', text: task.title, style: 'color: var(--color-text-muted);' }));
          depList.appendChild(depItem);
        });

        checklistDeps.forEach(item => {
          const isAllCompleted = item.dependsOn === '*' && (task.checklist || []).every(c => c.id === item.id || c.completed);
          const prereq = item.dependsOn === '*' ? null : (task.checklist || []).find(c => c.id === item.dependsOn);
          const pStatus = (item.dependsOn === '*' ? isAllCompleted : (prereq && prereq.completed)) ? 'Completed' : 'Pending';

          const depItem = el('div', { 
            class: 'dep-item', 
            style: 'display: flex; align-items: center; gap: 8px; font-size: 0.8125rem;' 
          });
          depItem.appendChild(el('span', { text: item.dependsOn === '*' ? 'All Task (*)' : (prereq ? prereq.text : 'Unknown'), style: 'font-weight: 600;' }));
          
          const statusBadge = el('span', { 
            text: pStatus, 
            class: 'badge',
            style: `font-size: 9px; padding: 1px 6px; background-color: color-mix(in srgb, ${pStatus === 'Completed' ? 'var(--color-success)' : 'var(--color-warning)'}, transparent 85%); color: ${pStatus === 'Completed' ? 'var(--color-success)' : 'var(--color-warning)'}; border: 1px solid color-mix(in srgb, ${pStatus === 'Completed' ? 'var(--color-success)' : 'var(--color-warning)'}, transparent 70%); border-radius: 12px;` 
          });
          depItem.appendChild(statusBadge);
          
          depItem.appendChild(el('span', { class: 'dep-arrow', text: '→', style: 'color: var(--color-text-muted);' }));
          depItem.appendChild(el('span', { class: 'text-muted', text: `${task.title}: ${item.text}`, style: 'color: var(--color-text-muted);' }));
          depList.appendChild(depItem);
        });
      }
      cont.appendChild(depList);
    });
    paneContent.appendChild(depHeaderToggle);
    paneContent.appendChild(depContentToggle);

    if (!isArchived) {
      const [transRequestsHeaderToggle, transRequestsContentToggle] = createCollapsibleSection('Transaction Requests', false, (cont) => {
        const actionsWrap = el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-top: var(--space-2);' });

        const createActionCard = (icon, title, type, handler, isSpan = false) => {
          let cardStyle = `
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: var(--space-2);
            padding: var(--space-3);
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            cursor: pointer;
            font-family: inherit;
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--color-text);
            transition: all 0.2s ease-in-out;
            min-height: 70px;
            text-align: center;
          `;
          if (isSpan) {
            cardStyle += ' grid-column: span 2;';
          }

          const card = el('button', { type: 'button', style: cardStyle, class: 'quick-action-card' });
          
          card.addEventListener('mouseenter', () => {
            card.style.borderColor = 'var(--color-primary)';
            card.style.boxShadow = 'var(--shadow-sm)';
            card.style.transform = 'translateY(-1px)';
          });
          card.addEventListener('mouseleave', () => {
            card.style.borderColor = 'var(--color-border)';
            card.style.boxShadow = 'none';
            card.style.transform = 'none';
          });

          const iconEl = el('span', { text: icon, style: 'font-size: 1.25rem;' });
          const titleEl = el('span', { text: title, style: 'line-height: 1.2;' });
          card.appendChild(iconEl);
          card.appendChild(titleEl);

          card.addEventListener('click', (e) => {
            e.stopPropagation();
            handler();
          });

          return card;
        };

        // Billing Card
        let billingTitle = 'Billing';
        let billingHandler = null;
        if (Auth.can('billing:edit')) {
          billingTitle = 'Generate Billing';
          billingHandler = async () => this.openGenerateBillingModal(wr, task);
        } else if (Auth.can('billing:request')) {
          billingTitle = 'Request Billing';
          billingHandler = async () => this.submitOperationsRequest('billing', wr, task);
        }

        // Disbursement Card
        let disbTitle = 'Disbursement';
        let disbHandler = null;
        if (Auth.can('disbursement:create')) {
          disbTitle = 'Generate Disbursement';
          disbHandler = async () => this.openGenerateDisbursementModal(wr, task);
        } else if (Auth.can('disbursement:request')) {
          disbTitle = 'Request Disbursement';
          disbHandler = async () => this.submitOperationsRequest('disbursement', wr, task);
        }

        // Transmittal Card
        let transTitle = 'Transmittal';
        let transHandler = null;
        if (Auth.can('transmittal:create')) {
          transTitle = 'Generate Transmittal';
          transHandler = async () => this.openGenerateTransmittalModal(wr, task);
        } else if (Auth.can('transmittal:request')) {
          transTitle = 'Request Transmittal';
          transHandler = async () => this.submitOperationsRequest('transmittal', wr, task);
        }

        const cardsToRender = [];
        if (billingHandler) cardsToRender.push({ icon: '📄', title: billingTitle, type: 'billing', handler: billingHandler });
        if (disbHandler) cardsToRender.push({ icon: '💸', title: disbTitle, type: 'disbursement', handler: disbHandler });
        if (transHandler) cardsToRender.push({ icon: '📦', title: transTitle, type: 'transmittal', handler: transHandler });

        cardsToRender.forEach((c, idx) => {
          const isSpan = (cardsToRender.length === 3 && idx === 2) || (cardsToRender.length === 1);
          const card = createActionCard(c.icon, c.title, c.type, c.handler, isSpan);
          actionsWrap.appendChild(card);
        });

        cont.appendChild(actionsWrap);
      });

      paneContent.appendChild(transRequestsHeaderToggle);
      paneContent.appendChild(transRequestsContentToggle);
    }

    const fullPageRoute = wr ? `#operations/detail/${wr.id}` : null;
    window.SidePaneInstance.recordId = task.id;
    window.SidePaneInstance.open({
      title: task.title || 'Task Details',
      content: paneContent,
      viewContext: 'task-detail',
      recordId: task.id,
      fullPageRoute,
      onClose: () => {
        window.SidePaneInstance.recordId = null;
      },
      triggerElement: triggerElement
    });
  },

  statusBadge(status) {
    const map = {
      'Draft': 'badge-draft',
      'Pre-processing': 'badge-preprocessing',
      'Processing': 'badge-processing',
      'Billing': 'badge-processing',
      'Disbursement': 'badge-processing',
      'Completed': 'badge-success',
      'Cancelled': 'badge-danger'
    };
    return el('span', { class: 'badge ' + (map[status] || 'badge-neutral'), text: status });
  },

  getFinanceBadgeForWr(wr) {
    const related = WorkflowData.getRelatedForWorkRequest(wr.id);
    const invoices = related.invoices || [];
    const disbursements = related.disbursements || [];

    if (wr.category === 'Financial Action' || wr.category === 'Financial' || (wr.title && (wr.title.includes('Financial') || wr.title.includes('Tax') || wr.title === '2'))) {
      return el('span', { class: 'badge badge-financial-action', text: 'FINANCIAL ACTION' });
    }

    if (invoices.length > 0 || disbursements.length > 0) {
      const allInvoicesPaid = invoices.every(inv => inv.status === 'Paid');
      const allDisbursementsReleased = disbursements.every(d => d.status === 'Released');

      if (allInvoicesPaid && allDisbursementsReleased) {
        return el('span', { class: 'badge badge-info', text: 'FINANCIAL SETTLED' });
      } else {
        return el('span', { class: 'badge badge-financial-action', text: 'FINANCIAL ACTION' });
      }
    }

    return el('span', { class: 'badge badge-standard', text: 'STANDARD' });
  },

  getItemsBadgeForWr(wr) {
    const count = wr.extraItemsCount || (wr.tasks && wr.tasks.length > 1 ? wr.tasks.length - 1 : 0);
    if (count > 0 || (wr.title && (wr.title.includes('Annual Tax') || wr.title.includes('Q2')))) {
      const num = count || 1;
      return el('span', { class: 'badge badge-items', text: `+${num} ITEMS` });
    }
    return null;
  },

  getDocBadgeForWr(wr) {
    const documents = WorkflowData.getRelatedForWorkRequest(wr.id).documents || [];

    let text = 'NO DOCUMENTS';
    let cls = 'badge-no-docs';

    if (documents.length > 0) {
      const storedCount = documents.filter(d => d.lifecycleState === 'stored').length;
      text = `DOCS: ${storedCount}/${documents.length} STORED`;
      cls = storedCount === documents.length ? 'badge-success' : 'badge-warn';
    }

    return el('span', { class: 'badge ' + cls, text });
  },

  getPriorityBadgeForWr(wr) {
    const priority = wr.priority || 'Normal';
    const pMap = {
      'Urgent': { text: 'Urgent', bg: '#fee2e2', fg: '#991b1b' },
      'Priority': { text: 'Priority', bg: '#fef3c7', fg: '#92400e' },
      'Low Priority': { text: 'Low Priority', bg: '#dcfce7', fg: '#166534' },
      'Normal': { text: 'Normal', bg: '#f1f5f9', fg: '#475569' }
    };
    const pConfig = pMap[priority] || pMap['Normal'];
    return el('span', {
      text: 'Priority: ' + pConfig.text,
      style: 'font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 12px; background: ' + pConfig.bg + '; color: ' + pConfig.fg + '; display: inline-flex; align-items: center; border: 1px solid rgba(0,0,0,0.05);'
    });
  },

  renderProgressBar(status) {
    // Four-stage lifecycle inside work request detail.
    const stages = ['Work Request', 'Pre-processing', 'Processing', 'Documentation'];
    const map = { 'Draft': 0, 'Pre-processing': 1, 'Processing': 2, 'Billing': 2, 'Disbursement': 2, 'Completed': 3, 'Cancelled': 3 };
    const current = map[status] ?? 0;
    const wrap = el('div', { class: 'workflow-progress' });
    stages.forEach((s, i) => {
      const step = el('div', { class: 'progress-step', text: s });
      if (i < current) step.classList.add('completed');
      else if (i === current) step.classList.add('active');
      wrap.appendChild(step);
    });
    return wrap;
  },

  // ============================================================
  // Create / Edit Form
  // ============================================================
  async renderForm() {
    if (!Auth.can('workflow:edit')) {
      this.view = 'list';
      App.handleRoute();
      return el('div');
    }

    // Cancel any previous form-level document listener so repeated renders
    // (opening the panel multiple times) do not leak global listeners.
    if (this._wrFormAbortController) {
      this._wrFormAbortController.abort();
    }
    this._wrFormAbortController = new AbortController();

    const entity = Auth.activeEntity;
    const wr = this.editingId ? WorkflowData.getWorkRequestById(this.editingId) : null;
    if (this.editingId && (!wr || !Auth.canViewWr(wr))) {
      this.view = 'list';
      App.handleRoute();
      return el('div');
    }
    const container = el('div');

    const form = el('form', { id: 'wr-form', class: 'form-stacked notion-form' });

    // ── Title free-form ──
    const titleSection = el('div', { class: 'notion-freeform notion-freeform--title' });
    titleSection.appendChild(el('label', { class: 'notion-section-label', text: 'Work Request Title' }));
    const titleInput = el('input', {
      type: 'text', name: 'title', class: 'notion-freeform-input notion-title-input',
      placeholder: 'New Work Request', required: true,
      value: wr ? (wr.title || '') : ''
    });
    titleSection.appendChild(titleInput);
    if (!wr) {
      setTimeout(() => { titleInput.focus(); }, 60);
    }
    form.appendChild(titleSection);

    // ── Top property grid ──
    const propsGrid = el('div', { class: 'notion-property-grid' });

    // Client
    const clientGroup = el('div', { class: 'notion-prop' });
    clientGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Client' }));
    const clientSel = el('select', { name: 'clientId', class: 'notion-prop-select', required: true });
    clientSel.appendChild(el('option', { value: '', text: '— Select —' }));
    (window.apiClient.clientCache._clients || []).filter(c => matchesEntity(c.entity, entity)).forEach(c => {
      const opt = el('option', { value: c.id, text: c.name });
      if (wr && wr.clientId === c.id) opt.selected = true;
      clientSel.appendChild(opt);
    });
    clientGroup.appendChild(clientSel);
    propsGrid.appendChild(clientGroup);

    // Priority
    const priorityGroup = el('div', { class: 'notion-prop' });
    priorityGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg> Priority' }));
    const prioritySel = el('select', { name: 'priority', class: 'notion-prop-select', required: true });
    ['Urgent', 'Priority', 'Low Priority'].forEach(p => {
      const opt = el('option', { value: p, text: p });
      if (wr && wr.priority === p) opt.selected = true;
      prioritySel.appendChild(opt);
    });
    if (wr && wr.priority && !['Urgent','Priority','Low Priority'].includes(wr.priority)) {
      const fallbackOpt = el('option', { value: wr.priority, text: wr.priority });
      fallbackOpt.selected = true;
      prioritySel.insertBefore(fallbackOpt, prioritySel.firstChild);
    }
    if (!wr) prioritySel.value = 'Priority';
    priorityGroup.appendChild(prioritySel);
    propsGrid.appendChild(priorityGroup);

    // Due Date
    const dueGroup = el('div', { class: 'notion-prop' });
    dueGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Due Date' }));
    dueGroup.appendChild(el('input', { type: 'date', name: 'dueDate', class: 'notion-prop-input', required: true, value: wr ? (wr.dueDate || '') : '' }));
    propsGrid.appendChild(dueGroup);

    // Assignee
    const assigneeGroup = el('div', { class: 'notion-prop' });
    assigneeGroup.appendChild(el('label', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Assignee' }));
    const assigneeSel = el('select', { name: 'assignedTo', class: 'notion-prop-select', required: true });
    assigneeSel.appendChild(el('option', { value: '', text: '— Select —' }));
    (window.apiClient.userCache._users || []).filter(u => {
      return (u.entities || []).some(e => matchesEntity(e, entity));
    }).forEach(u => {
      const opt = el('option', { value: u.id, text: u.name });
      if (wr && wr.assignedTo === u.id) opt.selected = true;
      assigneeSel.appendChild(opt);
    });
    assigneeGroup.appendChild(assigneeSel);
    propsGrid.appendChild(assigneeGroup);

    form.appendChild(propsGrid);

    // ── Description free-form ──
    const descSection = el('div', { class: 'notion-freeform notion-freeform--description' });
    descSection.appendChild(el('label', { class: 'notion-section-label', text: 'Description' }));
    descSection.appendChild(el('input', { type: 'text', name: 'description', class: 'notion-freeform-input', placeholder: 'What is this work request about?', value: wr ? (wr.description || '') : '' }));
    form.appendChild(descSection);

    // Use Retainer Template button (only on creation, not edit) — placed above tasks
    const templates = (this._retainerTemplates || []).filter(t => this._entityMatchesRetainerTemplate(t, entity));
    let selectedTemplateId = null;
    let templateBtnRef = null;
    if (!wr && templates.length > 0) {
      const templateWrapper = el('div', { class: 'notion-template-picker' });
      const templateBtn = el('button', {
        type: 'button', class: 'notion-add-line-item',
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg> Use Retainer Template'
      });
      templateBtnRef = templateBtn;
      const templateDropdown = el('div', { class: 'template-dropdown hidden' });
      const noneItem = el('div', { class: 'template-dropdown-item active', text: '— None —' });
      noneItem.dataset.templateId = '';
      templateDropdown.appendChild(noneItem);
      templates.forEach(t => {
        const item = el('div', { class: 'template-dropdown-item', text: t.name });
        item.dataset.templateId = t.id;
        templateDropdown.appendChild(item);
      });
      templateBtn.addEventListener('click', (e) => { e.stopPropagation(); templateDropdown.classList.toggle('hidden'); });
      document.addEventListener('click', () => { templateDropdown.classList.add('hidden'); }, { signal: this._wrFormAbortController.signal });
      templateDropdown.addEventListener('click', (e) => e.stopPropagation());
      templateWrapper.appendChild(templateBtn);
      templateWrapper.appendChild(templateDropdown);
      form.appendChild(templateWrapper);
    }

    // Template dropdown item click handler (wired after form fields exist)
    if (!wr && templates.length > 0) {
      const templateDropdown = form.querySelector('.template-dropdown');
      const dropdownItems = templateDropdown.querySelectorAll('.template-dropdown-item');
      const clientSel = form.querySelector('[name="clientId"]');
      const prioritySel = form.querySelector('[name="priority"]');
      dropdownItems.forEach(item => {
        item.addEventListener('click', async () => {
          const templateId = item.dataset.templateId;
          selectedTemplateId = templateId;
          const tasksList = document.getElementById('task-rows');
          const template = templateId ? this._getRetainerTemplateById(templateId) : null;

          dropdownItems.forEach(di => di.classList.remove('active'));
          item.classList.add('active');

          if (templateBtnRef) {
            const svgIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';
            templateBtnRef.innerHTML = `${svgIcon} ${template ? escapeHtml(template.name) : 'Use Retainer Template'}`;
          }

          templateDropdown.classList.add('hidden');

          if (tasksList) {
            if (template) {
              // Fill form fields from template
              const titleInput = form.querySelector('input[name="title"]');
              const descInput = form.querySelector('input[name="description"]');
              const dueDateInput = form.querySelector('input[name="dueDate"]');
              const now = new Date();
              const titleSuffix = now.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });

              if (titleInput) titleInput.value = `${template.name} (${titleSuffix})`;
              if (descInput) descInput.value = template.description || '';

              if (dueDateInput) {
                const dueDate = new Date(now);
                if (template.schedule === 'quarterly') {
                  dueDate.setMonth(dueDate.getMonth() + 3);
                } else {
                  dueDate.setMonth(dueDate.getMonth() + 1);
                }
                dueDateInput.value = dueDate.toISOString().slice(0, 10);
              }

              if (clientSel && template.clientId) clientSel.value = template.clientId;
              if (prioritySel) prioritySel.value = 'Priority';

              // Load template tasks
              this.loadTemplateTasks(templateId, tasksList);

              // Lock fields
              this.setTemplateFieldsLocked(form, tasksList, true);
            } else {
              // "None" selected — clear and unlock
              const titleInput = form.querySelector('input[name="title"]');
              const descInput = form.querySelector('input[name="description"]');
              const dueDateInput = form.querySelector('input[name="dueDate"]');

              if (titleInput) titleInput.value = '';
              if (descInput) descInput.value = '';
              if (dueDateInput) dueDateInput.value = '';
              if (clientSel) clientSel.value = '';
              if (prioritySel) prioritySel.value = 'Urgent';

              while (tasksList.firstChild) tasksList.removeChild(tasksList.firstChild);
              await this.addTaskRow(tasksList);
              await this.addTaskRow(tasksList);
              this.updatePredecessorOptions(tasksList);

              this.setTemplateFieldsLocked(form, tasksList, false);
            }
          }
        });
      });
    }

    // Retainer checkbox
    const retainerGroup = el('div', { class: 'form-group' });
    const retLabel = el('label', { class: 'checkbox-label' });
    const retCb = el('input', { type: 'checkbox', name: 'isRetainer' });
    retLabel.appendChild(retCb);
    retLabel.appendChild(document.createTextNode(' Save as retainer template'));
    retainerGroup.appendChild(retLabel);

    const scheduleGroup = el('div', { class: 'form-group hidden', id: 'retainer-schedule' });
    scheduleGroup.appendChild(el('label', { text: 'Schedule' }));
    const scheduleSel = el('select', { name: 'schedule' });
    ['monthly', 'quarterly'].forEach(s => scheduleSel.appendChild(el('option', { value: s, text: s })));
    scheduleGroup.appendChild(scheduleSel);
    retainerGroup.appendChild(scheduleGroup);

    const amountGroup = el('div', { class: 'form-group hidden', id: 'retainer-amount' });
    amountGroup.appendChild(el('label', { text: 'Professional Fee Amount (₱)' }));
    amountGroup.appendChild(el('input', { type: 'number', name: 'templateAmount', min: 0, step: 0.01 }));
    retainerGroup.appendChild(amountGroup);

    retCb.addEventListener('change', () => {
      scheduleGroup.classList.toggle('hidden', !retCb.checked);
      amountGroup.classList.toggle('hidden', !retCb.checked);
    });
    form.appendChild(retainerGroup);

    // Tasks section — Notion-style editable list
    // The "Tasks" heading is placed outside the line-item container so it acts as
    // a typographic group label rather than a box header.
    form.appendChild(el('h3', { class: 'notion-section-heading', text: 'Tasks' }));
    const tasksSection = el('div', { class: 'notion-line-items' });
    const tasksList = el('div', { class: 'notion-line-item-list', id: 'task-rows' });
    tasksSection.appendChild(tasksList);

    const addTaskBtn = el('button', {
      type: 'button',
      class: 'notion-add-line-item',
      'data-role': 'add-task',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add task'
    });
    addTaskBtn.addEventListener('click', async () => {
      await this.addTaskRow(tasksList, null, true);
      this.updatePredecessorOptions(tasksList);
    });
    tasksSection.appendChild(addTaskBtn);
    form.appendChild(tasksSection);

    // Pre-populate existing tasks if editing
    if (wr) {
      const existingTasks = wr.tasks || WorkflowData.getTasksWhere(t => t.workRequestId === wr.id);
      for (const t of existingTasks) await this.addTaskRow(tasksList, t);
    } else {
      await this.addTaskRow(tasksList);
      await this.addTaskRow(tasksList);
    }
    this.updatePredecessorOptions(tasksList);

    form.addEventListener('submit', async e => { e.preventDefault(); await this.submitForm(form); });

    container.appendChild(form);
    return container;
  },

  async addTaskRow(container, taskData, collapseOthers = false) {
    if (collapseOthers) {
      container.querySelectorAll('.task-row, .notion-line-item-row, .wr-task-row').forEach(r => r.classList.add('collapsed'));
    }
    const row = el('div', { class: 'notion-line-item-row wr-task-row task-row' });
    row.dataset.taskKey = taskData?.id || generateId('tmp');

    const dragHandle = el('div', {
      class: 'notion-line-item-drag',
      title: 'Drag to reorder',
      html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>'
    });
    row.appendChild(dragHandle);

    // Toggle caret for collapse/expand
    const caret = el('button', { type: 'button', class: 'task-row-toggle', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>' });
    caret.addEventListener('click', () => {
      row.classList.toggle('collapsed');
    });
    row.appendChild(caret);

    // Detect if existing task depends on every previous task -> show as "All (*)"
    const existingPreds = taskData?.predecessors || taskData?.dependencies || [];
    const previousTaskKeys = Array.from(container.querySelectorAll('.wr-task-row')).map(r => r.dataset.taskKey);
    const dependsOnAllPrevious = previousTaskKeys.length > 0 && previousTaskKeys.every(k => existingPreds.includes(k));
    if (dependsOnAllPrevious) {
      row.dataset.predKeys = '*';
    } else {
      row.dataset.predKeys = existingPreds.join(',');
    }

    const titleIn = el('input', { type: 'text', placeholder: 'Task title', class: 'task-title-input', value: taskData?.title || '' });
    titleIn.addEventListener('input', () => this.updatePredecessorOptions(container));
    row.appendChild(titleIn);

    // Ground worker assignee — typable dropdown like the filter tray
    const gwDropdown = await this.createGroundWorkerDropdown({
      selectedGroundWorkerName: taskData?.assigneeName || '',
      placeholder: 'Employee...',
      className: 'task-assignee-groundworker',
      onChange: () => {} // value is read at submit time
    });

    const assigneeWrapper = el('div', { class: 'task-assignee-wrapper' });
    assigneeWrapper.appendChild(gwDropdown);
    row.appendChild(assigneeWrapper);

    // Inline co-assignees (closure state on the row element)
    const coAssignees = taskData?.coAssignees ? [...taskData.coAssignees] : [];
    row._coAssignees = coAssignees;

    const coAssigneeWrap = el('div', { class: 'wr-task-row-coassignees' });
    const chipsWrap = el('div', { class: 'co-assignee-chips' });
    const renderCoChips = () => {
      chipsWrap.innerHTML = '';
      coAssignees.forEach((name, idx) => {
        const chip = el('span', { class: 'co-assignee-chip', text: name });
        const remove = el('span', { class: 'co-assignee-chip-remove', text: '×' });
        remove.addEventListener('click', () => {
          coAssignees.splice(idx, 1);
          renderCoChips();
        });
        chip.appendChild(remove);
        chipsWrap.appendChild(chip);
      });
    };
    renderCoChips();

    const coAssigneeDropdown = await this.createGroundWorkerDropdown({
      placeholder: '+ Co-assignee',
      className: 'inline-coassignee-dropdown',
      onChange: ({ assigneeName }) => {
        const name = assigneeName?.trim();
        if (!name) return;
        const primaryName = (gwDropdown.searchText || '').trim();
        if (name === primaryName) { coAssigneeDropdown.value = ''; return; }
        if (!coAssignees.includes(name)) {
          coAssignees.push(name);
          const isUser = ((window.apiClient.userCache._users || []) || []).some(u => u.name.toLowerCase() === name.toLowerCase());
          if (!isUser) {
            this._addGroundWorker(name);
          }
          renderCoChips();
        }
        coAssigneeDropdown.value = '';
      }
    });
    coAssigneeWrap.appendChild(chipsWrap);
    coAssigneeWrap.appendChild(coAssigneeDropdown);
    row.appendChild(coAssigneeWrap);

    // Custom Multi-select Dropdown
    const predWrapper = el('div', { class: 'multi-select-dropdown task-pred' });
    const predBtn = el('button', { type: 'button', class: 'multi-select-btn', text: '— No dependency —' });
    const predMenu = el('div', { class: 'multi-select-menu' });
    predWrapper.appendChild(predBtn);
    predWrapper.appendChild(predMenu);

    predBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.multi-select-menu.show').forEach(m => {
        if (m !== predMenu) m.classList.remove('show');
      });
      predMenu.classList.toggle('show');
    });
    predMenu.addEventListener('click', (e) => e.stopPropagation());

    row.appendChild(predWrapper);

    const removeBtn = el('button', {
      type: 'button',
      class: 'notion-line-item-remove',
      title: 'Remove',
      html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    });
    removeBtn.addEventListener('click', () => {
      row.querySelectorAll('.searchable-dropdown').forEach(d => {
        if (typeof d.destroy === 'function') d.destroy();
      });
      row.remove();
      this.updatePredecessorOptions(container);
    });
    row.appendChild(removeBtn);

    container.appendChild(row);
  },

  updatePredecessorOptions(container) {
    const rows = Array.from(container.querySelectorAll('.wr-task-row'));
    const tasks = rows.map((row, idx) => ({
      key: row.dataset.taskKey,
      label: row.querySelector('.task-title-input').value.trim() || `Task ${idx + 1}`
    }));

    rows.forEach((row, idx) => {
      const predWrapper = row.querySelector('.task-pred');
      if (!predWrapper) return;
      const predBtn = predWrapper.querySelector('.multi-select-btn');
      const predMenu = predWrapper.querySelector('.multi-select-menu');
      if (!predBtn || !predMenu) return;

      const currentKeys = (row.dataset.predKeys || '').split(',').filter(Boolean);
      predMenu.innerHTML = '';

      const updateSelection = () => {
        // Auto-check All Tasks (*) if all individual tasks are checked
        const allCheckbox = predMenu.querySelector('.multi-select-option input[value="*"]');
        const individualCheckboxes = Array.from(predMenu.querySelectorAll('.multi-select-option input')).filter(input => input.value !== '*');
        if (allCheckbox && !allCheckbox.checked && individualCheckboxes.length > 0 && individualCheckboxes.every(cb => cb.checked)) {
          allCheckbox.checked = true;
        }

        const checkedOptions = Array.from(predMenu.querySelectorAll('.multi-select-option input:checked'));
        let selectedKeys = checkedOptions.map(opt => opt.value);

        if (selectedKeys.includes('*')) {
          row.dataset.predKeys = '*';
          predBtn.textContent = 'All Tasks (*)';
          predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
            if (input.value !== '*') input.checked = true;
          });
        } else if (selectedKeys.length > 0) {
          row.dataset.predKeys = selectedKeys.join(',');
          const selectedLabels = selectedKeys.map(k => {
            const t = tasks.find(tsk => tsk.key === k);
            return t ? t.label : 'Task';
          });
          predBtn.textContent = selectedLabels.join(', ');
        } else {
          row.dataset.predKeys = '';
          predBtn.textContent = '— No dependency —';
        }
      };

      // 1. Add "All Tasks (*)"
      if (idx > 0) {
        const optionEl = el('label', { class: 'multi-select-option' });
        const checkbox = el('input', { type: 'checkbox', value: '*' });
        if (currentKeys.includes('*')) checkbox.checked = true;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
              if (input !== checkbox) input.checked = true;
            });
          } else {
            predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
              input.checked = false;
            });
          }
          updateSelection();
        });
        optionEl.appendChild(checkbox);
        optionEl.appendChild(document.createTextNode('All Tasks (*)'));
        predMenu.appendChild(optionEl);
      }

      // 2. Add individual tasks
      tasks.forEach((task, tIdx) => {
        if (task.key === row.dataset.taskKey) return;

        const optionEl = el('label', { class: 'multi-select-option' });
        const checkbox = el('input', { type: 'checkbox', value: task.key });
        
        const isPrevious = tIdx < idx;
        const shouldBeChecked = currentKeys.includes(task.key) || (currentKeys.includes('*') && isPrevious);
        if (shouldBeChecked) checkbox.checked = true;

        checkbox.addEventListener('change', () => {
          if (!checkbox.checked) {
            const allCheckbox = predMenu.querySelector('.multi-select-option input[value="*"]');
            if (allCheckbox) allCheckbox.checked = false;
          }
          updateSelection();
        });
        optionEl.appendChild(checkbox);
        optionEl.appendChild(document.createTextNode(task.label));
        predMenu.appendChild(optionEl);
      });

      updateSelection();
    });
  },

  validateManualAssignees(form) {
    // With the typable ground-worker-only dropdown, assignment is optional.
    // Just clear any lingering input-error states.
    const taskRows = form.querySelectorAll('.task-row');
    taskRows.forEach(row => {
      const gwAutocomplete = row.querySelector('.task-assignee-groundworker');
      if (gwAutocomplete) {
        const gwInput = gwAutocomplete.querySelector('input');
        gwInput?.classList.remove('input-error');
      }
    });
    return true;
  },

  async loadTemplateTasks(templateId, container) {
    if (!templateId) {
      this.showMessage('Error', 'Please select a retainer template first.', 'danger');
      return;
    }
    const template = this._getRetainerTemplateById(templateId);
    if (!template) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    for (const task of (template.tasks || [])) {
      await this.addTaskRow(container, task);
    }
    this.updatePredecessorOptions(container);
  },

  setTemplateFieldsLocked(form, tasksList, locked) {
    // Lock/unlock form-level fields (title, description, dueDate, client, priority)
    const fieldNames = ['title', 'description', 'dueDate', 'clientId', 'priority'];
    fieldNames.forEach(name => {
      const field = form.querySelector(`[name="${name}"]`);
      if (field) {
        const group = field.closest('.form-group');
        if (locked) {
          field.disabled = true;
          if (field.tagName === 'INPUT') field.readOnly = true;
          if (group) group.classList.add('template-locked');
        } else {
          field.disabled = false;
          if (field.tagName === 'INPUT') field.readOnly = false;
          if (group) group.classList.remove('template-locked');
        }
      }
    });

    // Lock/unlock task rows
    const tasksSection = tasksList.closest('.form-section');
    if (locked) {
      tasksSection.classList.add('tasks-template-locked');
      tasksList.querySelectorAll('.task-row').forEach(row => {
        row.classList.add('template-locked');
        const titleInput = row.querySelector('.task-title-input');
        const predBtn = row.querySelector('.task-pred .multi-select-btn');
        if (titleInput) { titleInput.disabled = true; titleInput.readOnly = true; }
        if (predBtn) predBtn.disabled = true;
      });
    } else {
      tasksSection.classList.remove('tasks-template-locked');
      tasksList.querySelectorAll('.task-row').forEach(row => {
        row.classList.remove('template-locked');
        const titleInput = row.querySelector('.task-title-input');
        const predBtn = row.querySelector('.task-pred .multi-select-btn');
        if (titleInput) { titleInput.disabled = false; titleInput.readOnly = false; }
        if (predBtn) predBtn.disabled = false;
      });
    }
  },

  async submitForm(form) {
    const isResubmitting = typeof PendingChanges !== 'undefined' && PendingChanges.editingPendingId;
    // Temporarily enable disabled fields so FormData picks them up
    const disabledFields = form.querySelectorAll('[disabled]');
    disabledFields.forEach(f => f.disabled = false);
    if (!validateRequiredFields(form)) { disabledFields.forEach(f => f.disabled = true); return; }
    if (!this.validateManualAssignees(form)) { disabledFields.forEach(f => f.disabled = true); return; }
    const data = Object.fromEntries(new FormData(form).entries());
    const entity = Auth.activeEntity;

    const now = new Date().toISOString();
    const record = {
      title: data.title.trim(),
      description: data.description?.trim() || '',
      clientId: data.clientId,
      priority: data.priority?.trim() || 'Priority',
      dueDate: data.dueDate || '',
      entity: entity,
      assignedTo: data.assignedTo || null,
      status: this.editingId ? (WorkflowData.getWorkRequestById(this.editingId)?.status || 'Draft') : 'Draft',
      updatedAt: now
    };

    if (!this.editingId) {
      record.requestedBy = Auth.user.id;
      record.boardOrder = 0;
    } else {
      const existingWr = WorkflowData.getWorkRequestById(this.editingId);
      record.boardOrder = existingWr?.boardOrder ?? 0;
    }

    // Collect tasks from rows
    const taskRows = form.querySelectorAll('.task-row');
    const tasks = [];
    for (const row of taskRows) {
      const title = row.querySelector('.task-title-input').value.trim();
      if (!title) continue;
      const gwAutocomplete = row.querySelector('.task-assignee-groundworker');
      const groundWorkerName = gwAutocomplete?.searchText?.trim() || '';

      const res = await this.resolveAssignee(groundWorkerName);

      const predKeysStr = row.dataset.predKeys || '';
      const predecessorKeys = predKeysStr.split(',').filter(Boolean);
      tasks.push({
        key: row.dataset.taskKey || generateId('tmp'),
        title,
        assigneeId: res.id,
        assigneeName: res.name,
        coAssignees: row._coAssignees || [],
        predecessorKeys: predecessorKeys
      });
    }

    const cycleCheck = tasks.map((t, i) => {
      let preds = [];
      if (t.predecessorKeys.includes('*')) {
        preds = tasks.slice(0, i).map(pt => pt.key);
      } else {
        preds = t.predecessorKeys;
      }
      return { id: t.key, predecessors: preds };
    });
    if (this.detectCycle(cycleCheck)) {
      this.showMessage('Dependency Error', 'Task dependencies contain a cycle. Please fix before saving.', 'danger');
      return;
    }

    const existingTasksById = {};
    if (this.editingId) {
      WorkflowData.getTasksWhere(t => t.workRequestId === this.editingId).forEach(t => {
        existingTasksById[t.id] = t;
      });
    }

    const recordId = this.editingId || generateId('wr');
    const idMap = new Map();
    tasks.forEach(t => idMap.set(t.key, generateId('t')));

    const resolvePredecessors = (t, i) => {
      if (t.predecessorKeys.includes('*')) {
        return tasks.slice(0, i).map(pt => idMap.get(pt.key)).filter(Boolean);
      }
      return t.predecessorKeys.map(k => idMap.get(k)).filter(Boolean);
    };

    const taskRecords = tasks.map((t, i) => {
      const existing = existingTasksById[t.key];
      return {
        id: idMap.get(t.key),
        workRequestId: recordId,
        title: t.title,
        assigneeId: t.assigneeId || null,
        assigneeName: t.assigneeName || null,
        coAssignees: t.coAssignees?.length ? t.coAssignees : (existing?.coAssignees || []),
        predecessors: resolvePredecessors(t, i),
        status: existing?.status || 'Draft',
        dueDate: record.dueDate,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        sortOrder: i,
        checklist: existing?.checklist || [],
        timeLogs: existing?.timeLogs || [],
        taskDocuments: existing?.taskDocuments || [],
        comments: existing?.comments || []
      };
    });

    const isNew = !this.editingId;
    if (isNew) {
      record.id = recordId;
      record.createdAt = now;
      record.linkedInvoiceId = null;
      record.linkedDisbursementIds = [];
      record.linkedTransmittalIds = [];
    } else {
      record.id = this.editingId;
      const existingWr = WorkflowData.getWorkRequestById(this.editingId);
      record.requestedBy = existingWr?.requestedBy || null;
      record.createdAt = existingWr?.createdAt || now;
      record.linkedInvoiceId = existingWr?.linkedInvoiceId || null;
      record.linkedDisbursementIds = existingWr?.linkedDisbursementIds || [];
      record.linkedTransmittalIds = existingWr?.linkedTransmittalIds || [];
    }

    record.tasks = taskRecords;
    const result = await PendingChanges.submit('workRequests', record, isNew);

    // Sync to the backend when the request is approved (admin/managerial save).
    const targetRoute = isResubmitting ? '#admin' : '#operations';
    let apiWrId = this.editingId;

    if (result.approved) {
      if (isNew) {
        this.editingId = null;
        const failedTaskTitles = [];
        const runResult = await this.runBlockingArchiveAction({
          title: 'Creating Work Request',
          message: `Please wait while "${record.title || 'the Work Request'}" is being saved...`,
          apiCall: async () => {
            // Optimistic insert so counts and the list under the overlay update immediately.
            record.tasks = [];
            WorkflowData._addOptimisticWorkRequest(record);
            record.tasks = taskRecords;
            this._updateCounts(1, 0);
            for (const t of taskRecords) {
              t.workRequestId = record.id;
              WorkflowData._addOptimisticTask(t);
            }

            try {
              let createdWr = null;
              let createdTasks = [];
              if (result.record && result.record.wr) {
                // Admin bypass already created the WR and tasks on the server.
                createdWr = result.record.wr;
                createdTasks = result.record.tasks || [];
                await WorkflowData._adoptServerWorkRequest(record.id, createdWr, createdTasks);
              } else {
                createdWr = await WorkflowData.createWorkRequest(record);
                for (const t of taskRecords) {
                  t.workRequestId = createdWr.id;
                  try {
                    createdTasks.push(await WorkflowData.createTask(t));
                  } catch (e) {
                    console.error('Failed to create task', t.title, e);
                    WorkflowData._removeTask(t.id);
                    failedTaskTitles.push(t.title);
                  }
                }
              }
              this._syncWorkRequestToCaches({ ...createdWr, tasks: createdTasks });
              return { data: createdWr };
            } catch (e) {
              // Roll back the optimistic records if the server mutation failed.
              console.error('Failed to create work request', e);
              WorkflowData._removeWorkRequest(record.id);
              for (const t of taskRecords) WorkflowData._removeTask(t.id);
              this._updateCounts(-1, 0);
              throw e;
            }
          },
          successTitle: 'Work Request Created',
          successMessage: failedTaskTitles.length
            ? `Work request created, but some tasks failed: ${failedTaskTitles.join(', ')}`
            : 'Work Request has been successfully created.',
          errorTitle: 'Failed to Create Work Request'
        });

        if (runResult.success) {
          if (typeof Dashboard !== 'undefined') {
            if (typeof Dashboard.invalidateCache === 'function') Dashboard.invalidateCache();
            else if (Dashboard._dataCache) Dashboard._dataCache = null;
          }
          this._invalidateCountsAndSidebar();
          closeFormPanelAndRoute(targetRoute);
        } else {
          App.handleRoute();
        }
        return;
      } else {
        this.editingId = null;
        const runResult = await this.runBlockingArchiveAction({
          title: 'Saving Work Request',
          message: `Please wait while "${record.title || 'the Work Request'}" is being updated...`,
          apiCall: async () => {
            await WorkflowData.updateWorkRequest(this.editingId, record);
            const existing = WorkflowData.getTasksWhere(t => t.workRequestId === this.editingId);
            for (const t of existing) await WorkflowData.deleteTask(t.id);
            for (const t of taskRecords) {
              t.workRequestId = this.editingId;
              await WorkflowData.createTask(t);
            }
            const updated = WorkflowData.getWorkRequestById(this.editingId);
            this._syncWorkRequestToCaches(updated);
            return { data: updated };
          },
          successTitle: 'Work Request Saved',
          successMessage: 'Work Request has been successfully updated.',
          errorTitle: 'Failed to Save Work Request'
        });

        if (runResult.success) {
          this._invalidateCountsAndSidebar();
        }
        closeFormPanelAndRoute(targetRoute);
        return;
      }
    }

    if (data.isRetainer && result.approved) {
      const tmplId = generateId('rt');
      const tmplMap = new Map();
      tasks.forEach(t => tmplMap.set(t.key, generateId('rtt')));
      const tmplTasks = tasks.map(t => {
        const predId = t.predecessorKey ? tmplMap.get(t.predecessorKey) : null;
        return {
          id: tmplMap.get(t.key),
          title: t.title,
          assigneeId: t.assigneeId || null,
          assigneeName: t.assigneeName || null,
          predecessors: predId ? [predId] : []
        };
      });
      await this._addRetainerTemplate({
        id: tmplId,
        name: record.title + ' Template',
        description: record.description,
        clientId: record.clientId,
        entity: record.entity,
        schedule: data.schedule || 'monthly',
        pfAmount: parseFloat(data.templateAmount) || 0,
        tasks: tmplTasks,
        createdAt: now,
        updatedAt: now
      });
    }

    if (result.approved) {
      if (typeof Dashboard !== 'undefined' && Dashboard.invalidateCache) Dashboard.invalidateCache();
      if (typeof App !== 'undefined' && App.updateSidebarNotifications) App.updateSidebarNotifications().catch(() => {});
    }

    if (isNew && result.approved) {
      // Create branch already closed the panel and showed its message.
      return;
    }

    // Non-approved create or approved update: close with the standard message.
    this.editingId = null;
    const msgConfig = {
      title: isNew ? 'Work Request Created' : 'Work Request Saved',
      message: result.approved
        ? (isNew ? 'Work Request has been successfully created.' : 'Work Request has been successfully updated.')
        : `Work Request ${isNew ? 'creation' : 'update'} request has been submitted for Admin approval.`,
      type: 'success'
    };
    closeFormPanelAndRoute(targetRoute, msgConfig);
  },

  /**
   * Renders an editable co-assignee chip list + dropdown for a saved task row.
   */
  clearDropdown(dd) {
    dd.value = '';
    const input = dd.querySelector('input');
    if (input) { input.value = ''; input.title = ''; }
    const clear = dd.querySelector('.searchable-dropdown-clear');
    if (clear) clear.style.display = 'none';
  },

  async renderTaskCoAssigneePicker(t, { primaryName = '', className = 'inline-coassignee-dropdown' } = {}, editable = false, showChips = true, onChange) {
    const wrap = el('div', { class: 'task-coassignee-wrap', style: 'margin-top:4px;' });
    const chipsWrap = el('div', { class: 'co-assignee-chips' });

    const renderChips = () => {
      chipsWrap.innerHTML = '';
      const coAssignees = t.coAssignees || [];
      coAssignees.forEach((name, idx) => {
        const chip = el('span', { class: 'co-assignee-chip' + (editable ? '' : ' readonly'), text: name });
        if (editable) {
          const remove = el('span', { class: 'co-assignee-chip-remove', text: '×' });
          remove.addEventListener('click', () => {
            const updated = coAssignees.filter((_, i) => i !== idx);
            WorkflowData.updateTask(t.id, { coAssignees: updated, updatedAt: new Date().toISOString() });
            if (onChange) onChange();
            App.handleRoute();
          });
          chip.appendChild(remove);
        }
        chipsWrap.appendChild(chip);
      });
    };
    renderChips();

    if (showChips) wrap.appendChild(chipsWrap);
    if (editable) {
      const addDropdown = await this.createGroundWorkerDropdown({
        placeholder: '+ Co-assignee',
        className,
        onChange: async ({ assigneeName }) => {
          const name = assigneeName?.trim();
          if (!name) return;
          const coAssignees = t.coAssignees || [];
          if (coAssignees.includes(name)) { this.clearDropdown(addDropdown); return; }
          if (name === primaryName) { this.clearDropdown(addDropdown); return; }
          await this._addGroundWorker(name);
          const updated = [...coAssignees, name];
          WorkflowData.updateTask(t.id, { coAssignees: updated, updatedAt: new Date().toISOString() });
          this.clearDropdown(addDropdown);
          if (onChange) onChange();
          App.handleRoute();
        }
      });
      wrap.appendChild(addDropdown);
    }
    return wrap;
  },

  async renderChecklistCoAssigneePicker(task, item, { primaryName = '', className = 'inline-coassignee-dropdown' } = {}, editable = false, showChips = true, onUpdate) {
    const wrap = el('div', { class: 'task-coassignee-wrap', style: 'margin-top:4px;' });
    const chipsWrap = el('div', { class: 'co-assignee-chips' });

    const renderChips = () => {
      chipsWrap.innerHTML = '';
      const coAssignees = item.coAssignees || [];
      coAssignees.forEach((name, idx) => {
        const chip = el('span', { class: 'co-assignee-chip' + (editable ? '' : ' readonly'), text: name });
        if (editable) {
          const remove = el('span', { class: 'co-assignee-chip-remove', text: '×' });
          remove.addEventListener('click', () => {
            const updated = coAssignees.filter((_, i) => i !== idx);
            item.coAssignees = updated;
            onUpdate();
          });
          chip.appendChild(remove);
        }
        chipsWrap.appendChild(chip);
      });
    };
    renderChips();

    if (showChips) wrap.appendChild(chipsWrap);
    if (editable) {
      const addDropdown = await this.createGroundWorkerDropdown({
        placeholder: '+ Co-assignee',
        className,
        onChange: async ({ assigneeName }) => {
          const name = assigneeName?.trim();
          if (!name) return;
          const coAssignees = item.coAssignees || [];
          if (coAssignees.includes(name)) { this.clearDropdown(addDropdown); return; }
          if (name === primaryName) { this.clearDropdown(addDropdown); return; }
          await this._addGroundWorker(name);
          const updated = [...coAssignees, name];
          item.coAssignees = updated;
          this.clearDropdown(addDropdown);
          onUpdate();
        }
      });
      wrap.appendChild(addDropdown);
    }
    return wrap;
  },

  renderAssigneeAvatarsList(allAssigneeNames) {
    const assigneeWrap = el('div', { class: 'assignee-avatars-list' });
    const displayNames = allAssigneeNames.slice(0, 5);
    const avatarColors = [
      { bg: 'color-mix(in oklab, var(--accent), transparent 80%)', fg: 'var(--accent)' },
      { bg: 'color-mix(in oklab, var(--success), transparent 80%)', fg: 'var(--success)' },
      { bg: 'color-mix(in oklab, var(--warn), transparent 80%)', fg: 'color-mix(in oklab, var(--warn), black 30%)' },
      { bg: 'color-mix(in oklab, var(--danger), transparent 80%)', fg: 'var(--danger)' },
      { bg: '#e5e5e5', fg: '#6b6b6b' }
    ];
    displayNames.forEach((name, idx) => {
      const user = (window.apiClient.userCache._users || []).filter(u => u.name === name)[0];
      const row = el('div', { class: 'assignee-avatar-row' });
      const av = el('div', { class: 'avatar-xs', title: name });
      const theme = avatarColors[idx % avatarColors.length];
      av.style.background = theme.bg;
      av.style.color = theme.fg;
      if (user?.avatarUrl) av.style.backgroundImage = `url('${user.avatarUrl}')`;
      else av.textContent = name.charAt(0).toUpperCase();
      row.appendChild(av);
      row.appendChild(el('span', { class: 'assignee-name', text: name }));
      assigneeWrap.appendChild(row);
    });
    if (allAssigneeNames.length > 5) {
      const overflow = el('span', {
        class: 'assignee-overflow',
        text: `+${allAssigneeNames.length - 5}`,
        title: allAssigneeNames.slice(5).join(', ')
      });
      assigneeWrap.appendChild(overflow);
    }
    if (allAssigneeNames.length === 0) {
      assigneeWrap.appendChild(el('span', { text: 'Unassigned', style: 'color:var(--muted);font-style:italic;' }));
    }
    return assigneeWrap;
  },

  async renderDetail() {
    await WorkflowData.loadPendingApprovals();
    await this._loadGroundWorkers();
    let wr = WorkflowData.getWorkRequestById(this.detailWrId);
    let wrDocs = [];
    if (this.detailWrId) {
      try {
        const docsRes = await window.apiClient.documents.list({ workRequestId: this.detailWrId });
        wrDocs = docsRes?.data || [];
      } catch (e) {
        console.error('[Workflow] failed to load DMS documents for detail view', e);
      }
    }
    if (!wr) {
      const pc = WorkflowData.getPendingApprovalByRecordId(this.detailWrId, 'workRequests');
      if (pc && pc.table === 'workRequests') {
        wr = { ...pc.proposedData };
        wr.id = pc.proposedData.id || pc.id;
        wr.isPendingApproval = true;
        wr.pendingChangeId = pc.id;
        wr.submittedBy = pc.submittedBy;
        wr.status = 'Draft';
      }
    }
    if (!wr) {
      this.view = 'list';
      this.detailWrId = null;
      location.hash = '#operations';
      return el('div');
    }
    if (this.lastRenderedWrId !== this.detailWrId) {
      this.lastRenderedWrId = this.detailWrId;
      this.expandedTaskIds.clear();
    }
    const client = window.apiClient.clientCache.getById(wr.clientId);
    const tasks = wr.isPendingApproval ? (wr.tasks || []) : WorkflowData.getTasksWhere(t => t.workRequestId === wr.id);
    tasks.forEach(t => this.ensureTaskChecklistNormalized(t));
    const canApprove = Auth.can('workflow:approve');
    const isDraft = wr.status === 'Draft';

    const container = el('div', { class: 'project-detail-v2' });
    container.selectedTaskIds = new Set();
    container.groupBy = 'phase';
    container.activeFilters = new Set();
    container.searchQuery = '';
    container.employeeFilter = null;

    // Lifecycle Card Redesign
    const lifecycleCard = el('div', { class: 'lifecycle-card' });
    const lifecycleHeader = el('div', { class: 'lifecycle-header' });
    lifecycleHeader.appendChild(el('div', { class: 'lifecycle-label', text: 'Lifecycle' }));

    const lifecycleActions = el('div', { class: 'lifecycle-actions' });
    
    const ts = this.getPhaseTransitionStatus(wr.id);
    const showRouteButton = ts && ts.nextPhase && ts.nextPhase !== 'Cancelled';
    const canCancel = Auth.isManagerial() && wr.status !== 'Completed' && wr.status !== 'Cancelled';
    const phaseColors = {
      'Draft': '#6b6b6b',
      'Pre-processing': '#2f6feb',
      'Processing': '#eab308',
      'Billing': '#f59e0b',
      'Disbursement': '#f59e0b',
      'Completed': '#17a34a',
      'Cancelled': '#dc2626'
    };

    if (canCancel) {
      const cancelWrBtn = el('button', {
        class: 'btn btn-sm btn-danger',
        text: 'Cancel Work Request',
        style: 'font-weight: 600; cursor: pointer;'
      });
      cancelWrBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cancelWorkRequest(wr.id);
      });
      lifecycleActions.appendChild(cancelWrBtn);
    }

    if (wr.status === 'Completed' && !wr.archived) {
      const archiveBtn = el('button', {
        class: 'btn btn-sm btn-primary',
        text: 'Archive Work Request',
        style: 'font-weight: 600; cursor: pointer; margin-right: 8px;'
      });
      archiveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.archiveWorkRequest(wr.id);
      });
      lifecycleActions.appendChild(archiveBtn);
    }

    if (showRouteButton) {
      const canRouteDirectly = Auth.user?.role === 'Admin' || Auth.isManagerial() || Auth.can('workflow:approve');
      const canRequest = !canRouteDirectly && this.canRequestPhaseRouting();
      const routeBtn = el('button', {
        class: 'btn btn-sm btn-primary',
        text: canRouteDirectly ? `Route to ${ts.nextPhase}` : `Request Route to ${ts.nextPhase}`,
        style: `font-weight: 600; cursor: ${ts.canTransition ? 'pointer' : 'not-allowed'};`,
        disabled: !ts.canTransition
      });
      if (ts.canTransition) {
        routeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.transitionWorkRequest(wr.id);
        });
      }
      lifecycleActions.appendChild(routeBtn);
    }

    lifecycleHeader.appendChild(lifecycleActions);
    lifecycleCard.appendChild(lifecycleHeader);

    // Modern Centered Progress Indicator
    lifecycleCard.appendChild(this.renderModernProgressBar(wr.status));

    // Routing dependency checklist — shows blockers + actionable hints
    if (ts && !ts.canTransition && ts.missing && ts.missing.length > 0 && wr.status !== 'Completed' && wr.status !== 'Cancelled') {
      const blockWrapper = el('div', { class: 'routing-block blocked' });
      const title = el('div', {
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg> <strong>Routing blocked</strong> — Resolve these to route to ' + (ts.nextPhase || 'next phase') + ':',
        class: 'routing-title',
        style: 'color:var(--fg);'
      });
      blockWrapper.appendChild(title);
      const depList = el('ul', { class: 'routing-list', style: 'color:var(--muted); width:100%; margin-top:8px;' });
      ts.missing.forEach(m => {
        const li = el('li');
        li.appendChild(el('span', { text: m, style: 'font-weight:600;' }));
        const hint = this.getRoutingHint(m);
        if (hint) {
          const hintEl = el('span', { style: 'font-size:11px;color:var(--muted);margin-left:8px;display:inline-block;' });
          hintEl.appendChild(el('span', { text: '→ ' + hint.text, style: 'font-style:italic;' }));
          if (hint.route) {
            const goBtn = el('button', {
              text: 'Go',
              class: 'btn btn-xs',
              style: 'margin-left:6px;padding:1px 6px;font-size:10px;background:color-mix(in oklab, var(--warn), transparent 85%);color:color-mix(in oklab, var(--warn), black 30%);border:none;border-radius: 12px;cursor:pointer;font-weight:600;'
            });
            goBtn.addEventListener('click', () => {
              if (hint.route === '#billing' && typeof Billing !== 'undefined') { Billing.view = 'list'; Billing.detailId = null; }
              if (hint.route === '#disbursement' && typeof Disbursement !== 'undefined') { Disbursement.view = 'list'; Disbursement.detailId = null; }
              location.hash = hint.route;
            });
            hintEl.appendChild(goBtn);
          }
          li.appendChild(hintEl);
        }
        depList.appendChild(li);
      });
      blockWrapper.appendChild(depList);
      lifecycleCard.appendChild(blockWrapper);
    } else if (ts && ts.canTransition && ts.nextPhase && wr.status !== 'Completed' && wr.status !== 'Cancelled') {
      const readyWrapper = el('div', { class: 'routing-block ready' });
      readyWrapper.appendChild(el('div', {
        html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> <strong>Ready to route</strong> — All requirements met. Click "Route to ' + ts.nextPhase + '" above to proceed.',
        class: 'routing-title'
      }));
      lifecycleCard.appendChild(readyWrapper);
    }

    if (wr.isPendingApproval) {
      const pendingWrapper = el('div', { class: 'routing-block blocked' });
      pendingWrapper.appendChild(el('div', {
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> This work request is pending approval. Actions are disabled until it\'s approved.',
        class: 'routing-title',
        style: 'color:#d97706;'
      }));
      lifecycleCard.appendChild(pendingWrapper);
    }

    container.appendChild(lifecycleCard);

    // Task List (Grouped div redesign)
    const listWrapper = el('div', { class: 'task-list task-list-no-card', id: 'taskList' });
    
    // Default Sorting: Priority > Due Date > Completed at bottom
    const sortedTasks = [...tasks].sort((a, b) => {
      const aComp = a.status === 'Completed' ? 1 : 0;
      const bComp = b.status === 'Completed' ? 1 : 0;
      if (aComp !== bComp) return aComp - bComp;

      const pMap = { 'Urgent': 3, 'Priority': 2, 'Low Priority': 1, 'Normal': 0 };
      const aP = pMap[a.priority] || 0;
      const bP = pMap[b.priority] || 0;
      if (aP !== bP) return bP - aP;

      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });

    const isDocStaff = Auth.can('dms:handover');
    const isArchived = wr.status === 'Cancelled';

    // End-of-day time log reminder banner (Manila 5 PM+)
    // Show to the Work Request owner (assignedTo or requestedBy) when ground worker checklist items are missing today's log.
    const now = new Date();
    const manilaHour = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' })).getHours();
    const isWrOwner = wr.assignedTo === Auth.user.id || wr.requestedBy === Auth.user.id;
    const todayStr = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })).toISOString().slice(0, 10);
    if (manilaHour >= 17 && !isArchived && isWrOwner && !wr.isPendingApproval) {
      const missingItems = [];
      sortedTasks.forEach(t => {
        if (t.status === 'Completed' || t.status === 'Cancelled') return;
        (t.checklist || []).forEach(item => {
          if (item.assigneeName && !item.assigneeId && !(item.timeLogs || []).some(l => l.date === todayStr)) {
            missingItems.push({ task: t, item });
          }
        });
      });
      if (missingItems.length > 0) {
        const reminderBanner = el('div', { class: 'eod-banner' });
        reminderBanner.appendChild(el('div', {
          html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
          style: 'flex-shrink:0;'
        }));
        const reminderText = el('div', { style: 'flex:1;' });
        reminderText.appendChild(el('div', {
          text: `⏰ End of day reminder: ${missingItems.length} checklist item(s) assigned to ground workers are missing a time log for today.`,
          style: 'font-weight:600;color:var(--fg);font-size:13px;'
        }));
        const logBtn = el('button', {
          text: 'Log Time Now',
          class: 'btn btn-primary btn-xs'
        });
        logBtn.addEventListener('click', () => { this.showAddTimeLogModal(missingItems[0].task.id, missingItems[0].item.id); });
        reminderText.appendChild(logBtn);
        const requestLink = el('button', {
          type: 'button',
          class: 'btn btn-ghost btn-xs',
          text: 'Request all missing logs'
        });
        requestLink.addEventListener('click', () => {
          const lines = missingItems.map(({ task: t, item }) => `- ${t.title}: ${item.text} (assigned to ${item.assigneeName})`);
          const subject = `Time Log Request: ${wr.title}`;
          const body = `Hi,\n\nPlease reply with your time logs for today (${todayStr}) for the following items:\n\n${lines.join('\n')}\n\nPlease include:\n- Start Time:\n- End Time:\n- Brief description of what you accomplished:\n\nThank you!`;
          navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => {
            this.showMessage('Copied', 'Time log request copied to clipboard.', 'success');
          }).catch(() => {
            this.showMessage('Error', 'Could not copy to clipboard.', 'danger');
          });
        });
        reminderText.appendChild(requestLink);
        reminderBanner.appendChild(reminderText);
        container.appendChild(reminderBanner);
      }
    }

    // Task view toolbar
    const toolbar = el('div', { class: 'task-view-toolbar' });

    // Initialize task view mode
    this.taskViewMode = this.taskViewMode || 'table';

    if (!ViewIcons.checklist) {
      ViewIcons.checklist = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
    }

    const viewToggle = el('div', { class: 'group-toggle', style: 'margin-right: 8px;' });
    const viewButtons = {};
    ['table', 'board', 'list', 'checklist'].forEach(mode => {
      const btn = el('button', {
        type: 'button',
        html: ViewIcons[mode] + ' ' + (mode === 'table' ? 'Table' : mode === 'board' ? 'Board' : mode === 'list' ? 'List' : 'Checklist'),
        class: this.taskViewMode === mode ? 'active' : ''
      });
      viewButtons[mode] = btn;
      btn.addEventListener('click', async () => {
        if (this.taskViewMode === mode) return;
        this.taskViewMode = mode;
        Object.keys(viewButtons).forEach(m => {
          viewButtons[m].classList.toggle('active', m === mode);
        });
        await renderGroups();
      });
      viewToggle.appendChild(btn);
    });
    toolbar.appendChild(viewToggle);


    // Employee Filter Options
    const empOptions = [{ value: '', text: 'All Employees' }];
    const uniqueEmpNames = new Set();
    ((window.apiClient.userCache._users || []) || []).forEach(u => {
      if (u.name) uniqueEmpNames.add(u.name.trim());
    });
    (this._groundWorkers || []).forEach(gw => {
      if (gw.name) uniqueEmpNames.add(gw.name.trim());
    });
    sortedTasks.forEach(t => {
      const names = getTaskAllAssigneeNames(t);
      names.forEach(name => {
        if (name) uniqueEmpNames.add(name.trim());
      });
    });
    Array.from(uniqueEmpNames).sort().forEach(name => {
      empOptions.push({ value: name, text: name });
    });

    const empFilter = createSearchableDropdown({
      placeholder: 'Filter Employee...',
      options: empOptions,
      maxWidth: '180px'
    });
    empFilter.value = container.employeeFilter || '';
    const updateEmpFilter = async () => {
      container.employeeFilter = (empFilter.searchText || '').trim() || empFilter.value || null;
      await renderGroups();
    };
    empFilter.addEventListener('change', updateEmpFilter);
    empFilter.addEventListener('input', updateEmpFilter);
    toolbar.appendChild(empFilter);



    // Compute filter counts from tasks
    const todayStrChip = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })).toISOString().slice(0, 10);
    const filterCounts = {
      'Missing logs': sortedTasks.filter(t => {
        if (t.status === 'Completed' || t.status === 'Cancelled') return false;
        const taskIsGround = t.assigneeName && !t.assigneeId;
        if (taskIsGround && !(t.timeLogs || []).some(l => l.date === todayStrChip)) return true;
        return (t.checklist || []).some(item => item.assigneeName && !item.assigneeId && !(item.timeLogs || []).some(l => l.date === todayStrChip));
      }).length,
      'Blocked': sortedTasks.filter(t => {
        const preds = t.predecessors || [];
        if (preds.some(pid => { const pt = WorkflowData.getTaskById(pid); return pt && pt.status !== 'Completed'; })) return true;
        return (t.checklist || []).some(item => isChecklistBlocked(item, t.checklist));
      }).length,
      'Incomplete checklist': sortedTasks.filter(t => {
        const comp = getTaskChecklistCompletion(t);
        return comp.total > 0 && comp.done < comp.total;
      }).length,
      'Mine': sortedTasks.filter(t => {
        if (t.assigneeId === Auth.user.id || t.assignedTo === Auth.user.id) return true;
        if (t.assigneeName && Auth.user?.name && t.assigneeName === Auth.user.name) return true;
        return false;
      }).length
    };

    const filterChips = el('div', { class: 'filter-chips' });
    const filterButtons = {};
    ['Missing logs', 'Blocked', 'Incomplete checklist', 'Mine'].forEach(filter => {
      const chip = el('button', {
        type: 'button',
        class: 'filter-chip' + (container.activeFilters.has(filter) ? ' active' : '')
      });
      const count = filterCounts[filter] || 0;
      if (count > 0) {
        chip.appendChild(el('span', { class: 'count', text: String(count) }));
      }
      chip.appendChild(document.createTextNode(filter));
      filterButtons[filter] = chip;
      chip.addEventListener('click', async () => {
        if (container.activeFilters.has(filter)) {
          container.activeFilters.delete(filter);
        } else {
          container.activeFilters.clear();
          container.activeFilters.add(filter);
        }
        updateToolbar();
        await renderGroups();
      });
      filterChips.appendChild(chip);
    });
    toolbar.appendChild(filterChips);

    const updateToolbar = () => {
      Object.keys(filterButtons).forEach(filter => {
        filterButtons[filter].classList.toggle('active', container.activeFilters.has(filter));
      });
    };

    const actionsWrap = el('div', {
      style: 'margin-left: auto; display: flex; gap: 12px; align-items: center; flex-wrap: wrap;'
    });

    const searchWrap = el('div', { class: 'search-input-wrapper' });

    const searchIcon = el('span', {
      class: 'search-icon',
      'aria-hidden': 'true',
      html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
    });

    const searchInput = el('input', {
      type: 'search',
      class: 'search-input form-control',
      placeholder: 'Search tasks, assignees, records…',
      id: 'taskSearch'
    });
    searchInput.addEventListener('input', async (e) => {
      container.searchQuery = e.target.value.toLowerCase();
      await renderGroups();
    });

    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);

    actionsWrap.appendChild(searchWrap);

    const canAddTaskInToolbar = Auth.can('workflow:edit') || Auth.can('workflow:task_add');
    if (canAddTaskInToolbar && !isArchived) {
      const addTaskBtn = el('button', {
        type: 'button',
        class: 'btn btn-primary btn-sm',
        text: '+ Add Task'
      });
      if (wr.isPendingApproval) {
        disableForApproval(addTaskBtn, 'Tasks cannot be added while the Work Request is awaiting approval.');
        
        const note = el('span', {
          text: '(Under approval)',
          style: 'font-size: 0.75rem; color: var(--muted); align-self: center; margin-left: 8px;'
        });
        actionsWrap.appendChild(addTaskBtn);
        actionsWrap.appendChild(note);
      } else {
        addTaskBtn.addEventListener('click', async () => {
          await this.showAddTaskPanel(wr.id);
        });
        actionsWrap.appendChild(addTaskBtn);
      }
    }

    toolbar.appendChild(actionsWrap);

    container.appendChild(toolbar);

    // Bulk action bar
    const bulkBar = el('div', { class: 'bulk-action-bar' });
    container.appendChild(bulkBar);

    // Pending tasks section — show pending tasks awaiting approval
    const pendingTaskChanges = WorkflowData.getPendingApprovalsWhere(pc =>
      pc.status === 'pending' && pc.table === 'tasks' && pc.proposedData && pc.proposedData.workRequestId === wr.id
    );
    if (pendingTaskChanges.length > 0) {
      const pendingSection = el('div', { class: 'pending-tasks-section', style: 'margin-bottom: 16px; padding: 16px; background: #fef9c3; border: 1px solid #fde68a; border-radius: 12px;' });
      pendingSection.appendChild(el('div', {
        html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <strong>Pending Task Approvals (' + pendingTaskChanges.length + ')</strong>',
        style: 'display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 0.875rem; color: #92400e;'
      }));

      pendingTaskChanges.forEach(pc => {
        const task = pc.proposedData;
        const submitter = window.apiClient.userCache.getById(pc.submittedBy);
        const row = el('div', { style: 'display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #fff; border: 1px solid #fde68a; border-radius: 12px; margin-bottom: 8px;' });

        const infoCol = el('div');
        infoCol.appendChild(el('div', { style: 'font-weight: 600; font-size: 0.875rem; color: #1f2937;', text: task.title }));
        infoCol.appendChild(el('div', {
          style: 'font-size: 0.75rem; color: #6b7280; margin-top: 2px;',
          text: 'Submitted by ' + (submitter?.name || 'Unknown') + ' • ' + new Date(pc.submittedAt).toLocaleDateString()
        }));
        if (task.assigneeName) {
          infoCol.appendChild(el('div', { style: 'font-size: 0.75rem; color: #6b7280;', text: 'Assignee: ' + task.assigneeName }));
        }
        row.appendChild(infoCol);

        if (PendingChanges.canApproveChange(pc)) {
          const btnRow = el('div', { style: 'display: flex; gap: 8px;' });
          const approveBtn = el('button', { class: 'btn btn-primary btn-xs', text: 'Approve' });
          approveBtn.addEventListener('click', () => {
            PendingChanges.approve(pc.id);
            App.handleRoute();
          });
          const rejectBtn = el('button', { class: 'btn btn-danger btn-xs', text: 'Reject' });
          rejectBtn.addEventListener('click', () => {
            const reason = prompt('Rejection reason (optional):');
            if (reason !== null) {
              PendingChanges.reject(pc.id, reason || '');
              App.handleRoute();
            }
          });
          btnRow.appendChild(approveBtn);
          btnRow.appendChild(rejectBtn);
          row.appendChild(btnRow);
        } else {
          row.appendChild(el('span', {
            text: 'Awaiting Approval',
            style: 'background: #fef3c7; color: #d97706; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px;'
          }));
        }

        pendingSection.appendChild(row);
      });

      container.appendChild(pendingSection);
    }

    // Empty-state guidance when WR has no tasks
    if (tasks.length === 0 && pendingTaskChanges.length === 0) {
      const actions = [];
      if (canAddTaskInToolbar && !isArchived) {
        actions.push({
          text: wr.isPendingApproval ? '+ Add First Task' : '+ Add First Task',
          className: 'btn btn-primary btn-sm',
          onClick: async () => {
            if (wr.isPendingApproval) return;
            await this.showAddTaskPanel(wr.id);
          }
        });
      }
      const emptyState = renderEmptyStateV2({
        variant: 'zero-state',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M17.636 18.364l-.707-.707M6.343 5.343l-.707-.707M3 12h1M5.343 18.364l.707-.707M12 21v-1M12 7a5 5 0 110 10 5 5 0 010-10z"/></svg>',
        title: 'No tasks yet',
        body: wr.isPendingApproval
          ? 'Tasks cannot be added while the Work Request is awaiting approval.'
          : 'Add the first task to begin tracking work for this request.',
        actions
      });
      if (wr.isPendingApproval && canAddTaskInToolbar && !isArchived) {
        const addBtn = emptyState.querySelector('.empty-state-actions button');
        if (addBtn) disableForApproval(addBtn, 'Tasks cannot be added while the Work Request is awaiting approval.');
      }
      container.appendChild(emptyState);
    }

    const updateBulkBar = async () => {
      bulkBar.innerHTML = '';
      const count = container.selectedTaskIds.size;
      if (count === 0) {
        bulkBar.style.display = 'none';
        return;
      }
      bulkBar.style.display = 'flex';
      bulkBar.appendChild(el('span', { class: 'bulk-selection-label', text: `${count} task${count === 1 ? '' : 's'} selected` }));

      const requestLogsBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Request Logs' });
      requestLogsBtn.addEventListener('click', () => {
        const todayStr = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })).toISOString().slice(0, 10);
        const selected = sortedTasks.filter(t => container.selectedTaskIds.has(t.id));
        const lines = [];
        selected.forEach(t => {
          if (t.status === 'Completed' || t.status === 'Cancelled') return;
          const taskIsGround = t.assigneeName && !t.assigneeId;
          const taskMissing = taskIsGround && !(t.timeLogs || []).some(l => l.date === todayStr);
          if (taskMissing) {
            lines.push(`- ${t.title} (assigned to ${t.assigneeName})`);
          }
          (t.checklist || []).forEach(item => {
            const itemIsGround = item.assigneeName && !item.assigneeId;
            const itemMissing = itemIsGround && !(item.timeLogs || []).some(l => l.date === todayStr);
            if (itemMissing) {
              lines.push(`- ${t.title}: ${item.text} (assigned to ${item.assigneeName})`);
            }
          });
        });
        const subject = `Time Log Request: ${wr.title}`;
        const body = lines.length > 0
          ? `Hi,\n\nPlease reply with your time logs for today (${todayStr}) for the following items:\n\n${lines.join('\n')}\n\nPlease include:\n- Start Time:\n- End Time:\n- Brief description of what you accomplished:\n\nThank you!`
          : `Hi,\n\nPlease reply with your time logs for today (${todayStr}).\n\nPlease include:\n- Start Time:\n- End Time:\n- Brief description of what you accomplished:\n\nThank you!`;
        navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => {
          this.showMessage('Copied', 'Time log request copied to clipboard.', 'success');
        }).catch(() => {
          this.showMessage('Error', 'Could not copy to clipboard.', 'danger');
        });
      });
      bulkBar.appendChild(requestLogsBtn);

      const assignWrap = el('div', { class: 'bulk-assign-wrap', style: 'display:flex; align-items:center; gap:8px;' });
      const assignDropdown = await this.createGroundWorkerDropdown({
        selectedGroundWorkerName: '',
        placeholder: 'Assign to...',
        maxWidth: '180px',
        className: 'bulk-assign-dropdown',
        onChange: () => {}
      });
      assignWrap.appendChild(assignDropdown);
      const assignBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Assign' });
      assignBtn.addEventListener('click', async () => {
        const name = (assignDropdown.searchText || '').trim();
        const res = await this.resolveAssignee(name);
        const selected = sortedTasks.filter(t => container.selectedTaskIds.has(t.id));
        // Bulk assign dropdown is single-select, so only one name can be chosen.
        // Treat that single name as the primary assignee and clear any co-assignees.
        selected.forEach(t => {
          WorkflowData.updateTask(t.id, {
            assigneeId: res.id,
            assigneeName: res.name,
            coAssignees: [],
            status: res.name ? 'Assigned' : 'Draft',
            updatedAt: new Date().toISOString()
          });
        });
        App.handleRoute();
      });
      assignWrap.appendChild(assignBtn);
      bulkBar.appendChild(assignWrap);

      const markDoneBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Mark Done' });
      markDoneBtn.addEventListener('click', () => {
        const selected = sortedTasks.filter(t => container.selectedTaskIds.has(t.id));
        let success = 0;
        const errors = [];
        selected.forEach(t => {
          const res = this.updateTaskStatus(t.id, 'Completed');
          if (res.error) {
            errors.push(`${t.title}: ${res.error}`);
          } else {
            success++;
          }
        });
        if (errors.length > 0) {
          this.showMessage('Bulk Mark Done', `${success} updated, ${errors.length} failed. ${errors.join(' ')}`, 'warning');
        } else {
          this.showMessage('Bulk Mark Done', `${success} task${success === 1 ? '' : 's'} marked Completed.`, 'success');
        }
        App.handleRoute();
      });
      bulkBar.appendChild(markDoneBtn);

      const logTimeBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Log Time' });
      logTimeBtn.addEventListener('click', () => {
        const selected = sortedTasks.filter(t => container.selectedTaskIds.has(t.id));
        if (selected.length === 0) return;
        const form = el('form', { class: 'form-stacked' });
        const workerInput = el('input', { type: 'text', name: 'workerName', placeholder: 'Worker name', value: Auth.user?.name || '' });
        form.appendChild(el('div', { class: 'form-group' }, [el('label', { text: 'Worker Name' }), workerInput]));
        const dateInput = el('input', { type: 'date', name: 'date', required: true, value: manilaToday() });
        form.appendChild(el('div', { class: 'form-group' }, [el('label', { text: 'Date *' }), dateInput]));
        const startInput = el('input', { type: 'time', name: 'start', required: true });
        form.appendChild(el('div', { class: 'form-group' }, [el('label', { text: 'Start Time *' }), startInput]));
        const endInput = el('input', { type: 'time', name: 'end', required: true });
        form.appendChild(el('div', { class: 'form-group' }, [el('label', { text: 'End Time *' }), endInput]));
        const noteInput = el('input', { type: 'text', name: 'note', placeholder: 'What did you work on?' });
        form.appendChild(el('div', { class: 'form-group' }, [el('label', { text: 'Note / Activity' }), noteInput]));
        const hoursInput = el('input', { type: 'text', name: 'hours', readOnly: true, value: '0.00', style: 'background: var(--bg); cursor: not-allowed;' });
        form.appendChild(el('div', { class: 'form-group' }, [el('label', { text: 'Calculated Hours' }), hoursInput]));

        function nextManilaDate(dateStr) {
          const d = new Date(dateStr + 'T00:00:00');
          d.setDate(d.getDate() + 1);
          return d.toISOString().slice(0, 10);
        }

        function updateHours() {
          const start = startInput.value;
          const end = endInput.value;
          if (start && end) {
            const [sh, sm] = start.split(':').map(Number);
            const [eh, em] = end.split(':').map(Number);
            const startMin = sh * 60 + sm;
            const endMin = eh * 60 + em;
            const totalMin = endMin > startMin ? endMin - startMin : endMin + 1440 - startMin;
            const hours = Math.round(totalMin / 60 * 4) / 4;
            hoursInput.value = hours.toFixed(2);
          } else {
            hoursInput.value = '0.00';
          }
        }
        startInput.addEventListener('change', updateHours);
        endInput.addEventListener('change', updateHours);
        const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Save Logs' });
        form.appendChild(submitBtn);
        const overlay = this.showModal('Bulk Log Time', form, null);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const dateVal = dateInput.value;
          const start = startInput.value;
          const end = endInput.value;
          const noteVal = noteInput.value;

          if (!dateVal || !start || !end) return;

          const [sh, sm] = start.split(':').map(Number);
          const [eh, em] = end.split(':').map(Number);
          const startMin = sh * 60 + sm;
          const endMin = eh * 60 + em;
          const workerName = workerInput.value.trim() || (window.apiClient.userCache.getById(Auth.user.id)?.name || '');

          let entries = [];
          if (endMin > startMin) {
            const hours = Math.round((endMin - startMin) / 60 * 4) / 4;
            if (hours > 0) entries.push({ date: dateVal, startTime: start, endTime: end, hours });
          } else {
            const hours1 = Math.round((1440 - startMin) / 60 * 4) / 4;
            const nextDate = nextManilaDate(dateVal);
            const hours2 = Math.round(endMin / 60 * 4) / 4;
            if (hours1 > 0) entries.push({ date: dateVal, startTime: start, endTime: '23:59', hours: hours1 });
            if (hours2 > 0) entries.push({ date: nextDate, startTime: '00:00', endTime: end, hours: hours2 });
          }

          if (entries.length === 0) {
            this.showMessage('Log too short', 'Log too short to record.', 'warning');
            return;
          }

          let skipped = 0;
          let saved = 0;
          selected.forEach(t => {
            const taskLogs = t.timeLogs || [];
            const alreadyLogged = entries.some(entry => taskLogs.some(l => l.date === entry.date && (l.workerName || '') === workerName));
            if (alreadyLogged) {
              skipped++;
              return;
            }
            const newEntries = entries.map(entry => ({
              userId: Auth.user.id,
              loggedByUserId: Auth.user.id,
              workerName,
              startTime: entry.startTime,
              endTime: entry.endTime,
              date: entry.date,
              note: noteVal,
              hours: entry.hours,
              checklistItemId: null
            }));
            WorkflowData.updateTask(t.id, {
              timeLogs: [...taskLogs, ...newEntries],
              updatedAt: new Date().toISOString()
            });
            saved++;
          });
          overlay.remove();
          this.showMessage('Bulk Log Time', `${saved} log${saved === 1 ? '' : 's'} saved, ${skipped} skipped (already logged).`, 'success');
          App.handleRoute();
        });
      });
      bulkBar.appendChild(logTimeBtn);

      const clearLink = el('a', { href: 'javascript:void(0)', class: 'bulk-clear-link', text: 'Clear' });
      clearLink.addEventListener('click', async () => {
        container.selectedTaskIds.clear();
        await updateBulkBar();
        await renderGroups();
      });
      bulkBar.appendChild(clearLink);
    };

    const renderGroups = async () => {
      listWrapper.innerHTML = '';
      if (tasks.length === 0) return;

      const todayStr = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })).toISOString().slice(0, 10);

      const activeFilters = Array.from(container.activeFilters);
      const query = (container.searchQuery || '').trim();
      const filteredTasks = sortedTasks.filter(t => {
        if (query) {
          const titleText = (t.title || '').toLowerCase();
          const assigneeText = (t.assigneeName || '').toLowerCase();
          const coAssigneeText = (t.coAssignees || []).map(name => (name || '').toLowerCase());
          
          const matchTitle = titleText.includes(query);
          const matchAssignee = assigneeText.includes(query);
          const matchCoAssignees = coAssigneeText.some(name => name.includes(query));
          
          if (!matchTitle && !matchAssignee && !matchCoAssignees) {
            return false;
          }
        }

        // Employee filter (matches primary, co-assignees, and sub-task assignees/co-assignees)
        if (container.employeeFilter) {
          const emp = container.employeeFilter.trim().toLowerCase();
          const primaryName = (t.assigneeName || '').trim().toLowerCase();
          const coAssignees = (t.coAssignees || []).map(name => (name || '').trim().toLowerCase());
          const checklistAssignees = (t.checklist || []).flatMap(item => {
            const names = [];
            if (item.assigneeName) names.push(item.assigneeName.trim().toLowerCase());
            if (item.coAssignees && Array.isArray(item.coAssignees)) {
              item.coAssignees.forEach(n => names.push(n.trim().toLowerCase()));
            }
            return names;
          });
          
          const matchPrimary = primaryName.includes(emp);
          const matchCo = coAssignees.some(name => name.includes(emp));
          const matchChecklist = checklistAssignees.some(name => name.includes(emp));
          if (!matchPrimary && !matchCo && !matchChecklist) return false;
        }



        if (activeFilters.length === 0) return true;

        const checks = {
          'Missing logs': () => {
            if (t.status === 'Completed' || t.status === 'Cancelled') return false;
            const taskIsGround = t.assigneeName && !t.assigneeId;
            const taskMissing = taskIsGround && !(t.timeLogs || []).some(l => l.date === todayStr);
            if (taskMissing) return true;
            return (t.checklist || []).some(item => {
              const itemIsGround = item.assigneeName && !item.assigneeId;
              if (!itemIsGround) return false;
              return !(item.timeLogs || []).some(l => l.date === todayStr);
            });
          },
          'Blocked': () => {
            const preds = t.predecessors || [];
            if (preds.some(pid => {
              const pt = WorkflowData.getTaskById(pid);
              return pt && pt.status !== 'Completed';
            })) return true;
            return (t.checklist || []).some(item => isChecklistBlocked(item, t.checklist));
          },
          'Incomplete checklist': () => {
            const comp = getTaskChecklistCompletion(t);
            return comp.total > 0 && comp.done < comp.total;
          },
          'Mine': () => {
            if (t.assigneeId === Auth.user.id || t.assignedTo === Auth.user.id) return true;
            if (t.assigneeName && Auth.user?.name && t.assigneeName === Auth.user.name) return true;
            if ((t.coAssignees || []).some(n => n && n === Auth.user?.name)) return true;
            return (t.checklist || []).some(item => item.assigneeName && item.assigneeName === Auth.user.name);
          }
        };

        return activeFilters.every(f => checks[f]());
      });

      const hasActiveFilters = query || container.employeeFilter || activeFilters.length > 0;
      const clearTaskFilters = async () => {
        container.activeFilters.clear();
        container.searchQuery = '';
        container.employeeFilter = null;
        if (empFilter) {
          const input = empFilter.querySelector('.searchable-dropdown-input');
          if (input) input.value = '';
          empFilter.value = '';
          empFilter.searchText = '';
        }
        const searchInput = document.getElementById('taskSearch');
        if (searchInput) searchInput.value = '';
        updateToolbar();
        await renderGroups();
      };

      if (filteredTasks.length === 0) {
        if (hasActiveFilters) {
          const filterNames = [
            ...(query ? [`search: "${query}"`] : []),
            ...(container.employeeFilter ? [`employee: ${container.employeeFilter}`] : []),
            ...activeFilters
          ];
          listWrapper.appendChild(renderFilterEmptyState(
            'No tasks match your filters',
            filterNames.length > 0
              ? `Active filters: ${filterNames.join(', ')}. Clear them to see all ${tasks.length} tasks.`
              : 'Adjust your search or filters to find tasks.',
            [{ text: 'Clear filters', className: 'btn btn-primary btn-sm', onClick: clearTaskFilters }]
          ));
        } else {
          listWrapper.appendChild(renderEmptyStateV2({
            variant: 'zero-state',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>',
            title: 'No tasks yet',
            body: 'This work request does not have any tasks. Add the first task to begin tracking work.',
            actions: [
              {
                text: '+ Add Task',
                className: 'btn btn-primary btn-sm',
                onClick: async () => {
                  await this.showAddTaskPanel(wr.id);
                }
              }
            ]
          }));
        }
        await updateBulkBar();
        return;
      }

      if (this.taskViewMode === 'board') {
        const statuses = ['Draft', 'Assigned', 'In Progress', 'For Review', 'Completed', 'Cancelled'];
        const statusColors = {
          'Draft': '#94a3b8',
          'Assigned': '#2f6feb',
          'In Progress': '#eab308',
          'For Review': '#a855f7',
          'Completed': '#17a34a',
          'Cancelled': '#dc2626'
        };
        const self = this;
        let taskNumber = 1;

        // Normalize per-column board orders so cards render consistently and
        // gaps from deleted/moved cards do not break drop midpoint calculations.
        const boardTasks = [];
        statuses.forEach(st => {
          const colTasks = filteredTasks.filter(t => t.status === st);
          colTasks.sort((a, b) => {
            const oa = typeof a.boardOrder === 'number' ? a.boardOrder : null;
            const ob = typeof b.boardOrder === 'number' ? b.boardOrder : null;
            if (oa !== null && ob !== null) return oa - ob;
            if (oa !== null) return -1;
            if (ob !== null) return 1;
            return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
          });
          colTasks.forEach((t, idx) => {
            const newOrder = (idx + 1) * 1000;
            if (t.boardOrder !== newOrder) {
              t.boardOrder = newOrder;
              WorkflowData.updateTask(t.id, { boardOrder: newOrder });
            }
          });
          boardTasks.push(...colTasks);
        });

        const board = KanbanBoard.render({
          items: boardTasks,
          className: 'board-v2',
          columns: statuses.map(st => ({
            key: st,
            label: st,
            targetStatus: st,
            color: statusColors[st] || '#cbd5e1',
            cardContainerStyle: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' },
            emptyState: { variant: 'compact', title: 'No tasks', body: '' }
          })),
          renderCard(t) {
            const comp = getTaskChecklistCompletion(t);
            const assigneeName = t.assigneeName || (t.assigneeId || t.assignedTo ? window.apiClient.userCache.getById(t.assigneeId || t.assignedTo)?.name : null);
            const priorityConfig = {
              'Urgent': { label: 'Urgent', cls: 'card-v2-priority-urgent' },
              'Priority': { label: 'Priority', cls: 'card-v2-priority-priority' },
              'High': { label: 'High', cls: 'card-v2-priority-urgent' },
              'Low Priority': { label: 'Low', cls: 'card-v2-priority-low' },
              'Low': { label: 'Low', cls: 'card-v2-priority-low' }
            }[t.priority] || { label: t.priority || 'Priority', cls: 'card-v2-priority-normal' };

            const counts = [];
            if (comp.total > 0) counts.push({ icon: BoardCardIcons.checklist, value: `${comp.percent}%` });

            const avatars = assigneeName ? [{ name: assigneeName }] : [];

            const card = buildCompactBoardCard({
              key: 'TSK-' + taskNumber++,
              progress: comp.percent,
              statusColor: statusColors[t.status] || '#cbd5e1',
              title: t.title,
              date: t.dueDate ? formatDate(t.dueDate) : '',
              priority: priorityConfig.label,
              priorityClass: priorityConfig.cls,
              avatars,
              counts,
              onClick: () => { self.showTaskSidePane(t.id, card); }
            });

            const completedClass = self.getCompletedClass(t);
            if (completedClass) {
              card.classList.add(completedClass);
            }

            if (window.SidePaneInstance && window.SidePaneInstance.isOpen() && window.SidePaneInstance.recordId === t.id) {
              card.classList.add('side-pane-active');
              window.SidePaneInstance.activeElement = card;
            }

            return card;
          },
          drag: {
            enabled: true,
            canDrag: t => {
              if (t.status === 'Completed' || t.status === 'Cancelled') return false;
              return Auth.can('workflow:task_approve') || Auth.can('workflow:edit') || Auth.can('workflow:task_add');
            },
            canDrop: ({ item, targetStatus }) => {
              if (item.status === targetStatus) return true;
              const allowed = self.getValidNextStatuses(item);
              // Always allow cancelling when the business rules permit it.
              if (targetStatus === 'Cancelled') return allowed.includes('Cancelled');
              const flow = ['Draft', 'Assigned', 'In Progress', 'For Review', 'Completed'];
              const currentIdx = flow.indexOf(item.status);
              const targetIdx = flow.indexOf(targetStatus);
              // Reject backwards moves; only allow forward progression.
              if (currentIdx === -1 || targetIdx === -1 || targetIdx <= currentIdx) return false;
              return allowed.includes(targetStatus);
            },
            orderField: 'boardOrder',
            onDrop({ item, targetStatus, newOrder, fromStatus }) {
              if (fromStatus === targetStatus) {
                WorkflowData.updateTask(item.id, { boardOrder: newOrder });
                App.handleRoute();
                return;
              }

              const result = self.updateTaskStatus(item.id, targetStatus);
              if (!result.success) {
                self.showMessage('Status Change Blocked', result.error, 'warning');
                return;
              }
              WorkflowData.updateTask(item.id, { boardOrder: newOrder });

              if (result.cascaded?.length) {
                self.showMessage(
                  'Task Updated',
                  `Status changed to ${targetStatus}. ${result.cascaded.length} dependent task(s) were cancelled.`,
                  'info'
                );
              }

              App.handleRoute();
            }
          }
        });

        board.style.marginTop = '0';
        listWrapper.appendChild(board);
        return;
      }

      if (this.taskViewMode === 'list') {
        const list = el('div', { class: 'list-view task-list-no-card operations-list-view', style: 'margin-top: 16px; display: flex; flex-direction: column; gap: var(--space-2);' });
        
        filteredTasks.forEach(t => {
          const row = el('div', { class: classNames('list-item', 'task-list-row-flat', this.getCompletedClass(t)), style: 'cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface);' });
          
          if (window.SidePaneInstance && window.SidePaneInstance.isOpen() && window.SidePaneInstance.recordId === t.id) {
            row.classList.add('side-pane-active');
            window.SidePaneInstance.activeElement = row;
          }

          row.addEventListener('click', () => {
            this.showTaskSidePane(t.id, row);
          });

          const textCol = el('div');
          textCol.appendChild(el('div', { class: 'list-item-title', text: t.title }));
          
          const assigneeName = t.assigneeName || (t.assigneeId || t.assignedTo ? window.apiClient.userCache.getById(t.assigneeId || t.assignedTo)?.name : null);
          const metaText = (assigneeName ? `${assigneeName} | ` : '') + (t.dueDate ? `Due: ${formatDate(t.dueDate)}` : 'No due date');
          textCol.appendChild(el('div', { class: 'list-item-meta', text: metaText }));
          
          const badgeRow = el('div', { style: 'display: flex; gap: 6px; margin-top: 4px;' });
          const pClass = { 'Urgent': 'badge-danger', 'Priority': 'badge-warn', 'Low Priority': 'badge-info' }[t.priority] || 'badge-muted';
          badgeRow.appendChild(el('span', { class: `badge ${pClass}`, text: t.priority || 'Normal' }));
          
          const comp = getTaskChecklistCompletion(t);
          if (comp.total > 0) {
            badgeRow.appendChild(el('span', { class: 'badge badge-info', text: `Checklist: ${comp.done}/${comp.total}` }));
          }
          textCol.appendChild(badgeRow);

          row.appendChild(textCol);
          
          const statusBadgeClass = {
            'Draft': 'badge-draft',
            'Assigned': 'badge-preprocessing',
            'In Progress': 'badge-processing',
            'For Review': 'badge-billing',
            'Completed': 'badge-success',
            'Cancelled': 'badge-danger'
          }[t.status] || 'badge-draft';
          row.appendChild(el('span', { class: `badge ${statusBadgeClass}`, text: t.status }));

          list.appendChild(row);
        });

        listWrapper.appendChild(list);
        return;
      }

      if (this.taskViewMode === 'checklist') {
        const clContainer = this.renderChecklistView(filteredTasks, isArchived);
        listWrapper.appendChild(clContainer);
        return;
      }

      let groups = {};
      if (container.groupBy === 'phase') {
        const name = wr.status ? `${wr.status} Tasks` : 'General Tasks';
        groups[name] = filteredTasks;
      } else if (container.groupBy === 'assignee') {
        filteredTasks.forEach(t => {
          const assignee = t.assigneeName
            ? { name: t.assigneeName }
            : window.apiClient.userCache.getById(t.assigneeId || t.assignedTo);
          const name = assignee?.name || 'Unassigned';
          groups[name] = groups[name] || [];
          groups[name].push(t);
        });
      } else {
        groups['All Tasks'] = filteredTasks;
      }

      for (const [groupName, groupTasks] of Object.entries(groups)) {
        const groupEl = el('div', { class: 'task-group-v2' });
        const groupHeader = el('div', { class: 'task-group-header' });
        groupHeader.appendChild(el('span', { text: groupName }));
        const totalCheckDone = groupTasks.reduce((sum, t) => sum + getTaskChecklistCompletion(t).done, 0);
        const totalCheckTotal = groupTasks.reduce((sum, t) => sum + getTaskChecklistCompletion(t).total, 0);
        const groupHours = groupTasks.reduce((sum, t) => sum + getTaskTotalHours(t), 0);
        const statsText = `${groupTasks.length} tasks${totalCheckTotal > 0 ? ` • ${totalCheckDone}/${totalCheckTotal} items done` : ''}${groupHours > 0 ? ` • ${groupHours} hrs` : ''}`;
        groupHeader.appendChild(el('span', { class: 'task-group-count group-header-stats', text: statsText }));

      groupEl.appendChild(groupHeader);

      const tableHeader = el('div', { class: 'table-header' });
      ['', 'Task', 'Assigned To', 'Due Date', 'Status', 'Checklist', 'Linked Records', 'Time', 'Actions'].forEach(h => {
        tableHeader.appendChild(el('span', { text: h }));
      });
      groupEl.appendChild(tableHeader);

      let totalHours = 0;

      for (const t of groupTasks) {
        let finActions = [];
        if (!isArchived) {
          finActions = this.getFinancialQuickActions(wr, t);
        }
        const assignee = t.assigneeName
          ? { name: t.assigneeName }
          : window.apiClient.userCache.getById(t.assigneeId || t.assignedTo);
        const hours = getTaskTotalHours(t);
        totalHours += hours;

        const expanded = this.expandedTaskIds.has(t.id);
        const selected = container.selectedTaskIds.has(t.id);
        const rowEl = el('div', { class: classNames('task-row', expanded && 'expanded', selected && 'selected', this.getCompletedClass(t)) });
        rowEl.dataset.id = t.id;

        // 1. Checkbox cell
        const cellCheckbox = el('div', { class: 'cell' });
        cellCheckbox.addEventListener('click', (e) => e.stopPropagation()); // Prevent accordion toggle
        const rowCheckbox = el('input', {
          type: 'checkbox',
          class: 'row-check',
          title: 'Select task'
        });
        rowCheckbox.checked = selected;
        if (!disableIfPending(rowCheckbox, wr)) {
          rowCheckbox.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (rowCheckbox.checked) {
              container.selectedTaskIds.add(t.id);
              rowEl.classList.add('selected');
            } else {
              container.selectedTaskIds.delete(t.id);
              rowEl.classList.remove('selected');
            }
            await updateBulkBar();
          });
        }
        cellCheckbox.appendChild(rowCheckbox);
        rowEl.appendChild(cellCheckbox);

        // 2. Title cell
        const cellTitle = el('div', { class: 'cell cell-title' });
        const caret = el('span', { class: 'caret', text: '›' });
        cellTitle.appendChild(caret);

        const titleStack = el('div', { class: 'title-stack' });
        const titleMain = el('span', {
          class: 'title-main' + (t.status === 'Completed' ? ' done' : ''),
          text: t.title
        });
        titleStack.appendChild(titleMain);

        // Show dependencies if they exist
        const preds = t.predecessors || [];
        if (preds.length > 0) {
          const predTitles = preds.map(pid => {
            const pt = WorkflowData.getTaskById(pid);
            return pt ? pt.title : null;
          }).filter(Boolean);
          if (predTitles.length > 0) {
            const depLabel = el('span', {
              class: 'title-sub',
              text: 'Blocking dependencies: ' + predTitles.join(', ')
            });
            titleStack.appendChild(depLabel);
          }
        }
        cellTitle.appendChild(titleStack);
        rowEl.appendChild(cellTitle);

        // 3. Assignee cell
        const cellAssignee = el('div', { class: 'cell assignee-cell' });
        cellAssignee.addEventListener('click', (e) => e.stopPropagation()); // Prevent accordion toggle

        const allAssigneeNames = getTaskAllAssigneeNames(t);

        if (wr.status === 'Draft') {
          // Ground worker assignee — typable dropdown like the filter tray
          const gwDropdown = await this.createGroundWorkerDropdown({
            selectedGroundWorkerName: t.assigneeName || '',
            placeholder: 'Employee...',
            className: 'inline-ground-worker-autocomplete',
            onChange: ({ assigneeId, assigneeName }) => {
              WorkflowData.updateTask(t.id, {
                assigneeId: assigneeId || null,
                assigneeName: assigneeName || null,
                status: assigneeName ? 'Assigned' : 'Draft',
                updatedAt: new Date().toISOString()
              });
              App.handleRoute();
            }
          });

          if (isPendingWr(wr)) {
            const input = gwDropdown.querySelector('input');
            if (input) disableForApproval(input);
            disableForApproval(gwDropdown);
          }

          const assigneeWrap = el('div', { class: 'task-assignee-wrapper' });
          assigneeWrap.appendChild(gwDropdown);
          assigneeWrap.appendChild(await this.renderTaskCoAssigneePicker(t, { primaryName: t.assigneeName || '', className: 'inline-coassignee-dropdown' }, isDraft && !wr.isPendingApproval, true));
          cellAssignee.appendChild(assigneeWrap);
        } else {
          cellAssignee.appendChild(this.renderAssigneeAvatarsList(allAssigneeNames));
        }
        rowEl.appendChild(cellAssignee);

        // 4. Due Date cell
        const cellDueDate = el('div', {
          class: 'cell time-cell',
          text: t.dueDate ? formatDate(t.dueDate) : 'N/A'
        });
        rowEl.appendChild(cellDueDate);

        // 5. Status cell
        const cellStatus = el('div', { class: 'cell' });
        cellStatus.addEventListener('click', (e) => e.stopPropagation()); // Prevent accordion toggle
        const statusWrapper = el('div', { class: 'status-dropdown-wrapper-v2' });
        const statusSel = el('select', { class: 'status-select' });
        const statusCaret = el('span', {
          class: 'status-dropdown-caret',
          'aria-hidden': 'true',
          html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`
        });

        const validStatuses = this.getValidNextStatuses(t);
        const flow = ['Draft', 'Assigned', 'In Progress', 'For Review', 'Completed', 'Cancelled'];
        const checklistCompletion = getTaskChecklistCompletion(t);
        const hasIncompleteChecklist = checklistCompletion.total > 0 && checklistCompletion.done < checklistCompletion.total;
        flow.forEach(s => {
          const opt = el('option', { value: s, text: s });
          if (s === t.status) opt.selected = true;
          const blockedByChecklist = hasIncompleteChecklist && (s === 'Completed' || s === 'For Review');
          const noAssignee = !(t.assigneeId || t.assignedTo || t.assigneeName);
          if (isArchived) {
            opt.disabled = true;
            opt.title = 'Work request is archived';
          } else if (blockedByChecklist) {
            opt.disabled = true;
            opt.title = `${checklistCompletion.total - checklistCompletion.done} of ${checklistCompletion.total} requirement items incomplete`;
          } else if (s === 'Assigned' && noAssignee) {
            opt.disabled = true;
            opt.title = 'Assign an employee first';
          } else if (!validStatuses.includes(s)) {
            opt.disabled = true;
            opt.title = `Cannot change to ${s} in this phase`;
          }
          statusSel.appendChild(opt);
        });
        if (isArchived) {
          statusSel.disabled = true;
        } else if (wr.isPendingApproval) {
          disableForApproval(statusSel);
        }

        // Status text colors chosen to stay discernible in both light and dark surfaces.
        const sColors = { 'Completed': '#22c55e', 'In Progress': '#f59e0b', 'Draft': '#94a3b8', 'For Review': '#3b82f6', 'Assigned': '#3b82f6', 'Cancelled': '#ef4444' };
        statusSel.style.color = sColors[t.status] || 'var(--fg)';

        statusSel.addEventListener('change', () => {
          const newStatus = statusSel.value;
          const originalStatus = t.status;
          const resetDropdown = () => {
            statusSel.value = originalStatus;
            statusSel.style.color = sColors[originalStatus] || 'var(--fg)';
          };
          if (newStatus === 'Completed' || newStatus === 'Cancelled') {
            this.showConfirm('Confirm Status Change',
              `Are you sure you want to mark this task as "${newStatus}"? This may affect dependencies and routing.`,
              () => {
                const res = this.updateTaskStatus(t.id, newStatus);
                if (res.error) {
                  this.showMessage('Error', res.error, 'danger');
                  resetDropdown();
                } else {
                  App.handleRoute();
                }
              },
              newStatus === 'Cancelled' ? 'danger' : 'warning',
              resetDropdown
            );
          } else {
            const res = this.updateTaskStatus(t.id, newStatus);
            if (res.error) {
              this.showMessage('Error', res.error, 'danger');
              resetDropdown();
            } else {
              App.handleRoute();
            }
          }
        });
        statusWrapper.appendChild(statusSel);
        statusWrapper.appendChild(statusCaret);
        cellStatus.appendChild(statusWrapper);
        rowEl.appendChild(cellStatus);

        // 6. Checklist cell
        const cellChecklist = el('div', { class: 'cell checklist-cell' });
        if (checklistCompletion.total === 0) {
          cellChecklist.appendChild(el('span', { text: 'N/A', class: 'text-muted' }));
        } else {
          const radius = 8;
          const circumference = 2 * Math.PI * radius; // ~50.27
          const offset = circumference - (checklistCompletion.percent / 100) * circumference;
          const ring = el('div', {
            class: 'progress-ring-wrapper',
            html: `<svg class="progress-ring" viewBox="0 0 20 20" style="width:18px; height:18px;"><circle cx="10" cy="10" r="${radius}" fill="none" stroke="var(--border)" stroke-width="3" /><circle cx="10" cy="10" r="${radius}" fill="none" stroke="var(--success)" stroke-width="3" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 10 10)" /></svg>`
          });
          const progressText = el('span', { class: 'progress-text', text: `${checklistCompletion.done}/${checklistCompletion.total}` });
          const incompleteNames = getIncompleteChecklistNames(t);
          cellChecklist.title = incompleteNames.length > 0 ? `Remaining: ${incompleteNames.join(', ')}` : 'All checklist items complete';
          cellChecklist.appendChild(ring);
          cellChecklist.appendChild(progressText);
        }
        rowEl.appendChild(cellChecklist);

        // 7. Linked Records cell
        const cellLinked = el('div', { class: 'cell' });
        const linkedWrap = el('div', { style: 'display:flex; flex-direction:column; gap:4px;' });
        
        const taskRelated = WorkflowData.getRelatedForTask(t.id);
        let linkedInv = taskRelated.invoices[0];
        if (!linkedInv) {
          const pc = WorkflowData.getPendingApprovalsWhere(p => p.table === 'invoices' && p.status === 'pending' && p.proposedData && p.proposedData.linkedTaskId === t.id)[0];
          if (pc) {
            linkedInv = deepClone(pc.proposedData);
            linkedInv.status = 'Pending';
            linkedInv.pendingChangeId = pc.id;
          }
        }
        const linkedDisb = taskRelated.disbursements;
        
        if (linkedInv) {
          const badgeText = '📄 ' + linkedInv.invoiceNumber + (linkedInv.status === 'Pending' ? ' (Pending)' : '');
          const badge = el('span', { class: 'badge badge-info', text: badgeText, style: 'cursor:pointer; font-size:10px;' });
          badge.addEventListener('click', (e) => { e.stopPropagation(); location.hash = '#billing/detail/' + linkedInv.id; });
          linkedWrap.appendChild(badge);
        }
        linkedDisb.forEach(d => {
          const badge = el('span', { class: 'badge badge-warning', text: '💸 ' + d.category, style: 'cursor:pointer; font-size:10px;' });
          badge.addEventListener('click', (e) => { e.stopPropagation(); location.hash = '#disbursement/detail/' + d.id; });
          linkedWrap.appendChild(badge);
        });
        
        const needsInvoice = t.title.toLowerCase().includes('invoice') || t.title.toLowerCase().includes('bill');
        const needsDisbursement = t.title.toLowerCase().includes('expense') || t.title.toLowerCase().includes('disburse') || t.title.toLowerCase().includes('payment') || t.title.toLowerCase().includes('reimburse');
        if (!isArchived && needsInvoice && !linkedInv) {
          const linkHint = el('span', {
            text: '⚠ Link invoice required',
            style: 'font-size:10px;color:var(--warn);font-weight:500;'
          });
          if (!disableIfPending(linkHint, wr)) {
            linkHint.style.cursor = 'pointer';
            linkHint.addEventListener('click', (e) => { e.stopPropagation(); this.showLinkFinancialModal(t.id); });
          }
          linkedWrap.appendChild(linkHint);
        }
        if (!isArchived && needsDisbursement && linkedDisb.length === 0) {
          const linkHint = el('span', {
            text: '⚠ Link expense required',
            style: 'font-size:10px;color:var(--warn);font-weight:500;'
          });
          if (!disableIfPending(linkHint, wr)) {
            linkHint.style.cursor = 'pointer';
            linkHint.addEventListener('click', (e) => { e.stopPropagation(); this.showLinkFinancialModal(t.id); });
          }
          linkedWrap.appendChild(linkHint);
        }

        if (!linkedInv && linkedDisb.length === 0 && !needsInvoice && !needsDisbursement) {
          linkedWrap.appendChild(el('span', { text: 'N/A', style: 'color:var(--muted);' }));
        }
        cellLinked.appendChild(linkedWrap);
        rowEl.appendChild(cellLinked);

        // 8. Time cell
        const cellTime = el('div', {
          class: 'cell time-cell font-mono',
          text: hours > 0 ? `${hours}h` : 'N/A'
        });
        rowEl.appendChild(cellTime);

        // 9. Actions cell
        const cellActions = el('div', { class: 'cell actions-cell' });
        cellActions.addEventListener('click', (e) => e.stopPropagation()); // Prevent accordion toggle

        // Log Time button
        const logTimeBtn = el('button', {
          class: 'action-icon primary',
          title: 'Log Time',
          html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
        });
        logTimeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showAddTimeLogModal(t.id);
        });

        // More Actions button and its native select overlay
        const actionMenu = el('div', { class: 'action-menu', style: 'position: relative; display: inline-block;' });

        const moreActionsBtn = el('button', {
          class: 'action-icon action-menu-toggle',
          title: 'More actions',
          html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/></svg>`
        });

        const selectEl = el('select', {
          class: 'action-menu-select',
          style: 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; z-index: 2;'
        });

        // Add empty placeholder option
        const placeholderOpt = el('option', { value: '', text: '', disabled: true, selected: true, hidden: true });
        selectEl.appendChild(placeholderOpt);

        const actionMap = {};

        // Log Time
        const optLogTime = el('option', { value: 'log-time', text: 'Log Time' });
        selectEl.appendChild(optLogTime);
        actionMap['log-time'] = () => this.showAddTimeLogModal(t.id);

        // Request Log
        if (t.assigneeName && !t.assigneeId) {
          const optReqLog = el('option', { value: 'request-log', text: 'Request Log' });
          selectEl.appendChild(optReqLog);
          actionMap['request-log'] = () => {
            const text = `Subject: Time Log Request: ${t.title}\n\nHi ${t.assigneeName},\n\nPlease reply with your time log for today for the task: ${t.title} (Work Request: ${wr.title}).\n\nPlease include:\n- Start Time:\n- End Time:\n- Brief description of what you accomplished:\n\nThank you!`;
            navigator.clipboard.writeText(text).then(() => {
              this.showMessage('Copied', `Time log request copied for ${t.assigneeName}.`, 'success');
            }).catch(() => {
              this.showMessage('Error', 'Could not copy to clipboard.', 'danger');
            });
          };
        }

        // Link Record
        const optLinkRecord = el('option', { value: 'link-record', text: 'Link Record' });
        selectEl.appendChild(optLinkRecord);
        actionMap['link-record'] = () => this.showLinkFinancialModal(t.id);

        // Edit Task
        const optEditTask = el('option', { value: 'edit-task', text: 'Edit Task' });
        selectEl.appendChild(optEditTask);
        actionMap['edit-task'] = () => this.showEditTaskModal(t.id, () => App.handleRoute());

        // Financial Actions
        finActions.forEach((act, index) => {
          const valueKey = `fin-action-${index}`;
          const opt = el('option', { value: valueKey, text: act.title });
          selectEl.appendChild(opt);
          actionMap[valueKey] = act.handler;
        });

        // Delete Task
        const optDelete = el('option', { value: 'delete', text: 'Delete' });
        selectEl.appendChild(optDelete);
        actionMap['delete'] = () => {
          this.showConfirm('Delete Task', 'Are you sure you want to delete this task? This will remove the task and all its checklist items.', async () => {
            const myGen = Workflow._startSkipGeneration();
            App.handleRoute();
            await WorkflowData.deleteTask(t.id);
            Workflow._clearSkipGenerationIfLatest(myGen);
            App.handleRoute();
          }, 'danger');
        };

        selectEl.addEventListener('change', () => {
          const val = selectEl.value;
          if (val && actionMap[val]) {
            actionMap[val]();
          }
          selectEl.value = '';
        });

        actionMenu.appendChild(moreActionsBtn);
        actionMenu.appendChild(selectEl);

        cellActions.appendChild(logTimeBtn);
        cellActions.appendChild(actionMenu);
        rowEl.appendChild(cellActions);

        groupEl.appendChild(rowEl);

        // Accordion Details Row (div layout)
        const detailsDiv = el('div', { class: 'detail-panel accordion-panel' + (expanded ? '' : ' hidden collapsed') });
        
        // Two-pane layout direct children of detail-panel
        const leftPane = el('div');
        const rightPane = el('div', { class: 'detail-pane' });

        // --- Left Pane: Requirements Checklist ---
        const checklistSection = el('div', { class: 'task-details-col' });
        const checklistHeader = el('div', { class: 'detail-section-title' });
        checklistHeader.appendChild(el('span', { text: 'Requirements Checklist' }));
        checklistSection.appendChild(checklistHeader);

        const checklistList = el('div', { class: 'details-content-list' });
        let populatePrereqSelect = () => {};
        const allowAssignChecklist = !wr || wr.status === 'Draft' || wr.status === 'Pre-processing';
        const allowAddRequirements = allowAssignChecklist;
        const normalizedChecklist = t.checklist || [];

        const renderChecklist = async () => {
          checklistList.innerHTML = '';
          if (normalizedChecklist.length === 0) {
            checklistList.appendChild(renderEmptyState('No checklist items'));
          } else {
            for (const [idx, item] of normalizedChecklist.entries()) {
              const blocked = isChecklistBlocked(item, normalizedChecklist);
              const prereq = item.dependsOn === '*' ? null : normalizedChecklist.find(c => c.id === item.dependsOn);
              const row = el('div', { class: 'checklist-item' + (blocked ? ' locked' : '') + (item.completed ? ' completed' : '') });
              const cb = el('input', { type: 'checkbox' });
              cb.checked = !!item.completed;
              cb.disabled = blocked;
              
              const textValue = blocked ? ('🔒 Waiting for: ' + (item.dependsOn === '*' ? 'All Task (*)' : (prereq ? prereq.text : 'Unknown'))) : item.text;
              
              // Wrapping text in checklist-text span/div structure
              const textWrap = el('div', { class: 'checklist-text' });
              textWrap.appendChild(el('span', { text: textValue, class: classNames(this.getCompletedClass(item)), title: textValue }));
              const categoryBadge = el('span', {
                text: item.category === 'document' ? 'Document' : 'Sub-task',
                class: 'checklist-category-badge',
                style: 'font-size:0.65rem; padding:1px 5px; border-radius: 12px; background:' + (item.category === 'document' ? '#dbeafe' : '#f3f4f6') + '; color:' + (item.category === 'document' ? '#1e40af' : '#4b5563') + '; font-weight:600; margin-left:6px;'
              });
              textWrap.appendChild(categoryBadge);

              cb.addEventListener('change', async (e) => {
                e.stopPropagation();
                this.toggleChecklistItem(t, item.id, cb.checked);
                await renderChecklist();
              });
              row.appendChild(cb);
              row.appendChild(textWrap);

              if (allowAssignChecklist) {
                const assigneeWrap = el('div', { class: 'task-assignee-wrapper' });
                const assigneeDropdown = await this.createGroundWorkerDropdown({
                  selectedGroundWorkerName: item.assigneeName,
                  placeholder: 'Assign...',
                  className: 'checklist-assignee-dropdown',
                  priorityNames: getTaskAllAssigneeNames(t),
                  onChange: async ({ assigneeId, assigneeName }) => {
                    item.assigneeName = assigneeName || null;
                    item.assigneeId = assigneeId || null;
                    WorkflowData.updateTask(t.id, { checklist: normalizedChecklist, updatedAt: new Date().toISOString() });
                    await renderChecklist();
                    App.handleRoute();
                  }
                });
                assigneeWrap.appendChild(assigneeDropdown);

                const coAssigneePicker = await this.renderChecklistCoAssigneePicker(
                  t,
                  item,
                  { primaryName: item.assigneeName || '', className: 'inline-coassignee-dropdown' },
                  !isArchived,
                  true,
                  async () => {
                    WorkflowData.updateTask(t.id, { checklist: normalizedChecklist, updatedAt: new Date().toISOString() });
                    await renderChecklist();
                    App.handleRoute();
                  }
                );
                assigneeWrap.appendChild(coAssigneePicker);
                row.appendChild(assigneeWrap);
              } else {
                const itemAssigneeNames = [];
                if (item.assigneeName) {
                  itemAssigneeNames.push(item.assigneeName);
                }
                if (item.coAssignees && Array.isArray(item.coAssignees)) {
                  item.coAssignees.forEach(name => {
                    if (name && !itemAssigneeNames.includes(name)) {
                      itemAssigneeNames.push(name);
                    }
                  });
                }
                const assigneeWrap = this.renderAssigneeAvatarsList(itemAssigneeNames);
                row.appendChild(assigneeWrap);
              }

              const itemHours = getChecklistItemTotalHours(item);
              const timePill = el('span', { class: 'hours-pill', text: itemHours + 'h' });
              row.appendChild(timePill);

              const checklistActions = el('div', { style: 'display:flex;gap:var(--space-1);' });
              const logBtn = el('button', { type: 'button', class: 'action-btn', text: 'Log Time' });
              if (!disableIfPending(logBtn, wr)) {
                logBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  this.showAddTimeLogModal(t.id, item.id);
                });
              }
              checklistActions.appendChild(logBtn);

              const delBtn = el('button', { type: 'button', class: 'action-btn', text: '×', style: 'border-color:transparent;color:var(--muted);' });
              if (!disableIfPending(delBtn, wr)) {
                delBtn.title = 'Delete checklist item';
                delBtn.addEventListener('click', async (e) => {
                  e.stopPropagation();
                  if (!item.timeLogs || item.timeLogs.length === 0) {
                    normalizedChecklist.splice(idx, 1);
                    WorkflowData.updateTask(t.id, { checklist: normalizedChecklist, updatedAt: new Date().toISOString() });
                    await renderChecklist();
                    populatePrereqSelect();
                  } else {
                    const content = el('div');
                    content.appendChild(el('p', { text: `This item has ${item.timeLogs.length} logged time record(s). Choose how to proceed:` }));
                    const actions = el('div', { class: 'checklist-delete-modal-actions' });
                    const reassignBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Reassign to task' });
                    const deleteAllBtn = el('button', { type: 'button', class: 'btn btn-danger', text: 'Delete logs & item' });
                    actions.appendChild(reassignBtn);
                    actions.appendChild(deleteAllBtn);
                    content.appendChild(actions);
                    const overlay = this.showModal('Delete Checklist Item', content, null);
                    reassignBtn.addEventListener('click', () => {
                      overlay.remove();
                      const task = WorkflowData.getTaskById(t.id) || t;
                      const logsToMove = (item.timeLogs || []).map(l => ({ ...l, checklistItemId: null }));
                      task.timeLogs = [...(task.timeLogs || []), ...logsToMove];
                      task.checklist = (task.checklist || []).filter(c => c.id !== item.id);
                      WorkflowData.updateTask(task.id, { checklist: task.checklist, timeLogs: task.timeLogs, updatedAt: new Date().toISOString() });
                      App.handleRoute();
                    });
                    deleteAllBtn.addEventListener('click', () => {
                      overlay.remove();
                      const task = WorkflowData.getTaskById(t.id) || t;
                      task.checklist = (task.checklist || []).filter(c => c.id !== item.id);
                      WorkflowData.updateTask(task.id, { checklist: task.checklist, updatedAt: new Date().toISOString() });
                      App.handleRoute();
                    });
                  }
                });
              }
              checklistActions.appendChild(delBtn);
              row.appendChild(checklistActions);

              checklistList.appendChild(row);
            }
          }
        };

        const checklistCard = el('div', { class: 'card card-compact', style: 'padding:0;' });
        checklistCard.appendChild(checklistList);
        checklistSection.appendChild(checklistCard);

        if (allowAddRequirements) {
          const addChecklistRow = el('div', { class: 'add-checklist', style: 'display: flex; gap: 8px; align-items: center;' });
          const newItemInput = el('input', { type: 'text', placeholder: 'Add checklist item...', id: 'newCheckInput', style: 'flex: 1;' });

          // Category selector for new checklist items
          const categorySel = el('select', { class: 'form-select', style: 'width: 110px; flex-shrink: 0;' });
          categorySel.appendChild(el('option', { value: 'subtask', text: 'Sub-task' }));
          categorySel.appendChild(el('option', { value: 'document', text: 'Document' }));

          // Custom single-select styled as dependency selector
          const predWrapper = el('div', { class: 'multi-select-dropdown', style: 'width: 160px;' });
          const predBtn = el('button', { type: 'button', class: 'multi-select-btn', text: '— Dependency —', style: 'width: 100%; height: 32px;' });
          const predMenu = el('div', { class: 'multi-select-menu', style: 'width: 100%;' });
          predWrapper.appendChild(predBtn);
          predWrapper.appendChild(predMenu);

          predBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.multi-select-menu.show').forEach(m => {
              if (m !== predMenu) m.classList.remove('show');
            });
            predMenu.classList.toggle('show');
          });
          predMenu.addEventListener('click', (e) => e.stopPropagation());

          let selectedPrereqId = null;

          populatePrereqSelect = () => {
            predMenu.innerHTML = '';
            
            // Option for None
            const noneOption = el('label', { class: 'multi-select-option' });
            const noneCheckbox = el('input', { type: 'checkbox', value: '' });
            if (!selectedPrereqId) noneCheckbox.checked = true;
            noneCheckbox.addEventListener('change', () => {
              selectedPrereqId = null;
              predBtn.textContent = '— Dependency —';
              predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
                if (input !== noneCheckbox) input.checked = false;
              });
              predMenu.classList.remove('show');
            });
            noneOption.appendChild(noneCheckbox);
            noneOption.appendChild(document.createTextNode('— Dependency —'));
            predMenu.appendChild(noneOption);

            // Option for All Task (*)
            const allOption = el('label', { class: 'multi-select-option' });
            const allCheckbox = el('input', { type: 'checkbox', value: '*' });
            if (selectedPrereqId === '*') allCheckbox.checked = true;
            allCheckbox.addEventListener('change', () => {
              if (allCheckbox.checked) {
                selectedPrereqId = '*';
                predBtn.textContent = 'All Task (*)';
                predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
                  if (input !== allCheckbox) input.checked = false;
                });
              } else {
                selectedPrereqId = null;
                predBtn.textContent = '— Dependency —';
              }
              predMenu.classList.remove('show');
            });
            allOption.appendChild(allCheckbox);
            allOption.appendChild(document.createTextNode('All Task (*)'));
            predMenu.appendChild(allOption);

            normalizedChecklist.forEach(item => {
              const option = el('label', { class: 'multi-select-option' });
              const checkbox = el('input', { type: 'checkbox', value: item.id });
              if (selectedPrereqId === item.id) checkbox.checked = true;
              checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                  selectedPrereqId = item.id;
                  predBtn.textContent = item.text;
                  predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
                    if (input !== checkbox) input.checked = false;
                  });
                } else {
                  selectedPrereqId = null;
                  predBtn.textContent = '— Dependency —';
                }
                predMenu.classList.remove('show');
              });
              option.appendChild(checkbox);
              option.appendChild(document.createTextNode(item.text));
              predMenu.appendChild(option);
            });
          };
          populatePrereqSelect();

          const addItemBtn = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Add' });
          if (wr.isPendingApproval) {
            disableForApproval(newItemInput);
            disableForApproval(categorySel);
            disableForApproval(predBtn);
            disableForApproval(addItemBtn);
          } else {
            addItemBtn.addEventListener('click', async () => {
              const val = newItemInput.value.trim();
              if (!val) return;
              const prereqId = selectedPrereqId || null;
              normalizedChecklist.push({ id: generateUUID(), text: val, category: categorySel.value || 'subtask', completed: false, assigneeId: null, assigneeName: null, dependsOn: prereqId, timeLogs: [] });
              WorkflowData.updateTask(t.id, { checklist: normalizedChecklist, updatedAt: new Date().toISOString() });
              newItemInput.value = '';
              selectedPrereqId = null;
              predBtn.textContent = '— Dependency —';
              populatePrereqSelect();
              await renderChecklist();
            });
          }
          addChecklistRow.appendChild(newItemInput);
          addChecklistRow.appendChild(categorySel);
          addChecklistRow.appendChild(predWrapper);
          addChecklistRow.appendChild(addItemBtn);
          checklistSection.appendChild(addChecklistRow);
        }
        leftPane.appendChild(checklistSection);
        await renderChecklist();

        // --- Collapsed Row Toolbar (Quick Actions) ---
        const detailToolbar = el('div', { class: 'detail-toolbar' });
        
        const logTimeHeaderBtn = el('button', {
          class: 'btn btn-primary btn-xs',
          html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Log Time`
        });
        if (!disableIfPending(logTimeHeaderBtn, wr)) {
          logTimeHeaderBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showAddTimeLogModal(t.id); });
        }
        detailToolbar.appendChild(logTimeHeaderBtn);

        if (t.assigneeName && !t.assigneeId) {
          const reqLogHeaderBtn = el('button', {
            class: 'btn btn-secondary btn-xs',
            html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Request Log`
          });
          if (!disableIfPending(reqLogHeaderBtn, wr)) {
            reqLogHeaderBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const text = `Subject: Time Log Request: ${t.title}\n\nHi ${t.assigneeName},\n\nPlease reply with your time log for today for the task: ${t.title} (Work Request: ${wr.title}).\n\nPlease include:\n- Start Time:\n- End Time:\n- Brief description of what you accomplished:\n\nThank you!`;
              navigator.clipboard.writeText(text).then(() => {
                this.showMessage('Copied', `Time log request copied for ${t.assigneeName}.`, 'success');
              }).catch(() => {
                this.showMessage('Error', 'Could not copy to clipboard.', 'danger');
              });
            });
          }
          detailToolbar.appendChild(reqLogHeaderBtn);
        }

        const linkRecordHeaderBtn = el('button', {
          class: 'btn btn-secondary btn-xs',
          html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Link Record`
        });
        if (!disableIfPending(linkRecordHeaderBtn, wr)) {
          linkRecordHeaderBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showLinkFinancialModal(t.id); });
        }
        detailToolbar.appendChild(linkRecordHeaderBtn);

        const editTaskHeaderBtn = el('button', {
          class: 'btn btn-ghost btn-xs',
          html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit`
        });
        if (!disableIfPending(editTaskHeaderBtn, wr)) {
          editTaskHeaderBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showEditTaskModal(t.id, () => App.handleRoute()); });
        }

        finActions.forEach(act => {
          const btn = el('button', {
            class: 'btn btn-secondary btn-xs',
            html: `${act.toolbarIconHtml} ${act.title}`
          });
          if (!disableIfPending(btn, wr)) {
            btn.addEventListener('click', (e) => { e.stopPropagation(); act.handler(); });
          }
          detailToolbar.appendChild(btn);
        });

        detailToolbar.appendChild(editTaskHeaderBtn);

        // Attached Documents Section
        const canHandover = Auth.can('dms:handover');
        const canEditDms = Auth.can('dms:edit');
        
        const docsSection = el('div', { class: 'detail-block' });
        const docsHeader = el('div', { class: 'detail-section-title' });
        docsHeader.appendChild(el('span', { text: 'Attached Documents' }));
        const canUploadTaskDocs = Auth.can('workflow:edit') || Auth.can('workflow:task_upload');
        if ((canHandover || canUploadTaskDocs) && !isArchived) {
          const addDocBtn = el('button', { class: 'btn btn-primary btn-xs btn-add-inline', text: '+ Upload' });
          if (!disableIfPending(addDocBtn, wr)) {
            addDocBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showAddDocumentModal(t.id, addDocBtn); });
          }
          docsHeader.appendChild(addDocBtn);
        }
        docsSection.appendChild(docsHeader);

        const docsList = el('div', { class: 'details-content-list' });
        if ((t.taskDocuments || []).length === 0) {
          docsList.appendChild(renderEmptyState('No documents attached'));
        } else {
          t.taskDocuments.forEach((d, dIdx) => {
            const item = el('div', { class: 'detail-item-v2', style: 'display:flex; justify-content:space-between; align-items:center;' });
            const leftSide = el('div', { style: 'display:flex; flex-direction:column;' });
            const fName = d.fileName || d.filename;

            const canViewDms = Auth.can('dms:view');
            if (canViewDms) {
              let dmsDoc = null;
              if (d.documentId) {
                dmsDoc = wrDocs.find(doc => doc.id === d.documentId);
              } else {
                const matches = wrDocs.filter(doc => doc.original_name === fName || doc.file_name === fName || doc.fileName === fName);
                if (matches.length === 1) {
                  dmsDoc = matches[0];
                  d.documentId = dmsDoc.id;
                }
              }

              if (dmsDoc) {
                const link = el('a', {
                  href: '#',
                  text: (d.isGoogleDrive ? '🟢 ' : '📎 ') + fName + (d.isGoogleDrive ? ' (Google Drive)' : ''),
                  style: `color:${d.isGoogleDrive ? '#22c55e' : 'var(--accent)'}; font-weight:600; text-decoration:underline; cursor:pointer;`
                });
                link.addEventListener('click', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  this.showDocumentPreview(dmsDoc.id);
                });
                leftSide.appendChild(link);
              } else if (d.linkUrl) {
                const link = el('a', {
                  href: d.linkUrl,
                  target: '_blank',
                  text: (d.isGoogleDrive ? '🟢 ' : '📎 ') + fName + (d.isGoogleDrive ? ' (Google Drive)' : ''),
                  style: `color:${d.isGoogleDrive ? '#22c55e' : 'var(--accent)'}; font-weight:600; text-decoration:underline; cursor:pointer;`
                });
                leftSide.appendChild(link);
              } else {
                leftSide.appendChild(el('span', { text: (d.isGoogleDrive ? '🟢 ' : '📎 ') + fName + (d.isGoogleDrive ? ' (Google Drive)' : '') }));
              }
            } else {
              leftSide.appendChild(el('span', { text: (d.isGoogleDrive ? '🟢 ' : '📎 ') + fName + (d.isGoogleDrive ? ' (Google Drive)' : '') }));
            }
            leftSide.appendChild(el('span', { class: 'kpi-label', text: formatDate(d.uploadDate) }));
            item.appendChild(leftSide);

            // Delete Button: Documentation and Admin can remove
            if (Auth.can('dms:handover')) {
              const delBtn = el('button', { 
                class: 'btn btn-ghost btn-xs', 
                text: '×', 
                style: 'color:var(--danger); font-size:1.2rem; padding:0 4px; line-height:1;' 
              });
              if (!disableIfPending(delBtn, wr)) {
                delBtn.title = 'Remove Attachment';
                delBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  this.showConfirm('Confirm Removal', `Are you sure you want to remove "${fName}" from this task?`, async () => {
                    const updatedTaskDocs = t.taskDocuments.filter((_, i) => i !== dIdx);
                    WorkflowData.updateTask(t.id, { taskDocuments: updatedTaskDocs });
                    const docIdToDelete = d.documentId || (wrDocs.find(doc => doc.fileName === fName && doc.workRequestId === wr.id) || {}).id;
                    if (docIdToDelete) {
                      try {
                        await window.apiClient.documents.remove(docIdToDelete);
                      } catch (err) {
                        console.error('Failed to delete DMS document', err);
                      }
                    }
                    App.handleRoute();
                  }, 'danger');
                });
              }
              item.appendChild(delBtn);
            }
            docsList.appendChild(item);

            // Comments
            const commentToggle = el('button', { class: 'btn btn-ghost btn-xs', text: '💬 Comments' + (d.comments?.length ? ` (${d.comments.length})` : ''), style: 'margin-left: 10px; font-size: var(--text-xs); color: var(--muted);' });
            const commentContainer = el('div', { class: 'doc-comments-container hidden', style: 'margin: 8px 0 16px 20px; padding: 12px; background: var(--bg); border-radius: var(--radius-sm); border-left: 3px solid var(--border);' });
            commentToggle.addEventListener('click', (e) => { e.stopPropagation(); commentContainer.classList.toggle('hidden'); });

            const renderComments = () => {
              commentContainer.innerHTML = '';
              const list = el('div', { style: 'display:flex; flex-direction:column; gap:8px;' });
              if (!d.comments || d.comments.length === 0) {
                list.appendChild(renderEmptyState('No comments for this document', null, { style: 'padding: 4px 0;' }));
              } else {
                d.comments.forEach((c, cIdx) => {
                  const commentRow = el('div', { style: 'background:var(--surface); padding:8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); position:relative;' });
                  const cUser = window.apiClient.userCache.getById(c.userId);
                  const header = el('div', { style: 'display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.75rem;' });
                  header.appendChild(el('span', { text: cUser?.name || 'Unknown', style: 'font-weight:600; color:var(--accent);' }));
                  header.appendChild(el('span', { text: formatDate(c.date), style: 'color:var(--muted);' }));
                  commentRow.appendChild(header);

                  const contentArea = el('div', { style: 'font-size:var(--text-sm); color:var(--fg); line-height:1.4;' });
                  contentArea.textContent = c.text;
                  commentRow.appendChild(contentArea);

                  // Admin Actions: Edit/Delete (disabled in archive)
                  if (Auth.can('workflow:approve') && !isArchived) {
                    const cActions = el('div', { style: 'display:flex; gap:8px; margin-top:8px; border-top:1px solid var(--border); padding-top:4px;' });
                    const editBtn = el('button', { class: 'btn btn-link btn-xs', text: 'Edit', style: 'padding:0; font-size:0.7rem;' });
                    if (!disableIfPending(editBtn, wr)) {
                      editBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const originalText = c.text;
                        contentArea.innerHTML = '';
                        const editInput = el('textarea', { class: 'form-control', style: 'width:100%; min-height:40px; font-size:0.875rem;', text: originalText });
                        contentArea.appendChild(editInput);
                        cActions.classList.add('hidden');
                        const editActions = el('div', { style: 'display:flex; gap:8px; margin-top:4px;' });
                        const saveEditBtn = el('button', { class: 'btn btn-primary btn-xs', text: 'Save' });
                        const cancelEditBtn = el('button', { class: 'btn btn-secondary btn-xs', text: 'Cancel' });
                        saveEditBtn.addEventListener('click', (ev) => {
                          ev.stopPropagation();
                          const newText = editInput.value.trim();
                          if (newText) {
                            c.text = newText;
                            c.date = new Date().toISOString();
                            WorkflowData.updateTask(t.id, { taskDocuments: t.taskDocuments });
                            renderComments();
                          }
                        });
                        cancelEditBtn.addEventListener('click', (ev) => { ev.stopPropagation(); renderComments(); });
                        editActions.appendChild(saveEditBtn);
                        editActions.appendChild(cancelEditBtn);
                        contentArea.appendChild(editActions);
                      });
                    }
                    const delCommentBtn = el('button', { class: 'btn btn-link btn-xs', text: 'Delete', style: 'padding:0; font-size:var(--text-xs); color:var(--danger);' });
                    if (!disableIfPending(delCommentBtn, wr)) {
                      delCommentBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showConfirm('Delete Comment', 'Are you sure you want to delete this comment?', () => {
                          d.comments.splice(cIdx, 1);
                          WorkflowData.updateTask(t.id, { taskDocuments: t.taskDocuments });
                          renderComments();
                          commentToggle.textContent = '💬 Comments' + (d.comments?.length ? ` (${d.comments.length})` : '');
                        }, 'danger');
                      });
                    }
                    cActions.appendChild(editBtn);
                    cActions.appendChild(delCommentBtn);
                    commentRow.appendChild(cActions);
                  }
                  list.appendChild(commentRow);
                });
              }
              commentContainer.appendChild(list);

              if (Auth.can('workflow:approve') && !isArchived) {
                const addForm = el('div', { style: 'margin-top:12px; padding-top:12px; border-top: 1px solid var(--border);' });
                const addInput = el('textarea', { placeholder: 'Write a comment...', class: 'form-control', style: 'width:100%; min-height:50px; font-size:0.875rem;' });
                const addBtnRow = el('div', { style: 'display:flex; gap:8px; margin-top:8px;' });
                const saveNewBtn = el('button', { class: 'btn btn-primary btn-sm', text: 'Save Comment' });
                if (wr.isPendingApproval) {
                  disableForApproval(addInput);

                  disableForApproval(saveNewBtn);
                } else {
                  saveNewBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const text = addInput.value.trim();
                    if (text) {
                      if (!d.comments) d.comments = [];
                      d.comments.push({ userId: Auth.user.id, date: new Date().toISOString(), text });
                      WorkflowData.updateTask(t.id, { taskDocuments: t.taskDocuments });
                      addInput.value = '';
                      renderComments();
                      commentToggle.textContent = '💬 Comments' + (d.comments?.length ? ` (${d.comments.length})` : '');
                    }
                  });
                }
                addBtnRow.appendChild(saveNewBtn);
                addForm.appendChild(addInput);
                addForm.appendChild(addBtnRow);
                commentContainer.appendChild(addForm);
              }
            };
            renderComments();
            docsList.appendChild(commentToggle);
            docsList.appendChild(commentContainer);
          });
        }
        docsSection.appendChild(docsList);
        rightPane.appendChild(docsSection);

        // Time Log History Section
        const timeSection = el('div', { class: 'detail-block' });
        const timeHeader = el('div', { class: 'detail-section-title' });
        timeHeader.appendChild(el('span', { text: 'Time Log History' }));
        timeSection.appendChild(timeHeader);

        const timeList = el('div', { class: 'details-content-list' });
        const logs = t.timeLogs || [];
        const checklistLogGroups = [];
        (t.checklist || []).forEach(item => {
          if (item.timeLogs && item.timeLogs.length > 0) checklistLogGroups.push({ item, logs: item.timeLogs });
        });
        if (logs.length === 0 && checklistLogGroups.length === 0) {
          timeList.appendChild(renderEmptyState(isArchived ? 'Archived' : 'No logs recorded', isArchived ? 'Time logging is disabled for archived items.' : null));
        } else {
          const buildTimeLogEntry = (l) => {
            const [y, m, d] = l.date.split('-').map(Number);
            const logDate = new Date(y, m - 1, d);
            const dateStr = logDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
            const workerLabel = l.workerName || (window.apiClient.userCache.getById(l.userId)?.name || l.userId || 'Unknown');
            const noteText = l.note ? ` — ${l.note}` : '';
            return el('div', { class: 'history-item' }, [
              el('div', {}, [
                el('strong', { text: workerLabel }),
                el('span', { text: noteText }),
                el('div', { class: 'history-meta', text: `${dateStr} • ${l.startTime}–${l.endTime}` })
              ]),
              el('span', { class: 'font-mono', text: `${l.hours}h` })
            ]);
          };
          const taskLevelLogs = logs.filter(l => !l.checklistItemId);
          if (taskLevelLogs.length > 0) {
            const sorted = [...taskLevelLogs].sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
            sorted.forEach(l => timeList.appendChild(buildTimeLogEntry(l)));
          }
          checklistLogGroups.forEach(({ item, logs: itemLogs }) => {
            const sorted = [...itemLogs].sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
            sorted.forEach(l => timeList.appendChild(buildTimeLogEntry(l)));
          });
        }
        timeSection.appendChild(timeList);
        rightPane.appendChild(timeSection);

        // Dependency map section
        const depSection = el('div', { class: 'detail-block' });
        const depHeader = el('div', { class: 'detail-section-title' });
        depHeader.appendChild(el('span', { text: 'Dependency Map' }));
        depSection.appendChild(depHeader);
        const depContent = el('div', { class: 'dep-list' });
        const taskPreds = t.predecessors || [];
        const checklistDeps = (t.checklist || []).filter(item => item.dependsOn);
        if (taskPreds.length === 0 && checklistDeps.length === 0) {
          depContent.appendChild(renderEmptyState('No dependencies'));
        } else {
          taskPreds.forEach(pid => {
            const pTask = WorkflowData.getTaskById(pid);
            const depItem = el('div', { class: 'dep-item' });
            depItem.appendChild(el('span', { text: pTask ? pTask.title : 'Unknown' }));
            depItem.appendChild(el('span', { class: 'dep-arrow', text: '→' }));
            depItem.appendChild(el('span', { class: 'text-muted', text: t.title }));
            depContent.appendChild(depItem);
          });
          checklistDeps.forEach(item => {
            const prereq = item.dependsOn === '*' ? null : (t.checklist || []).find(c => c.id === item.dependsOn);
            const depItem = el('div', { class: 'dep-item' });
            depItem.appendChild(el('span', { text: item.dependsOn === '*' ? 'All Task (*)' : (prereq ? prereq.text : 'Unknown') }));
            depItem.appendChild(el('span', { class: 'dep-arrow', text: '→' }));
            depItem.appendChild(el('span', { class: 'text-muted', text: `${t.title}: ${item.text}` }));
            depContent.appendChild(depItem);
          });
        }
        depSection.appendChild(depContent);
        rightPane.appendChild(depSection);

        detailsDiv.appendChild(detailToolbar);
        detailsDiv.appendChild(leftPane);
        detailsDiv.appendChild(rightPane);
        groupEl.appendChild(detailsDiv);

        // Row expand listener
        rowEl.addEventListener('click', (e) => {
          if (e.target.closest('input, select, button, .actions-cell, .inline-coassignee-dropdown, .inline-ground-worker-autocomplete')) return;
          const isNowExpanded = rowEl.classList.toggle('expanded');
          detailsDiv.classList.toggle('hidden');
          detailsDiv.classList.toggle('collapsed');
          if (isNowExpanded) {
            this.expandedTaskIds.add(t.id);
          } else {
            this.expandedTaskIds.delete(t.id);
          }
        });
      }

      // Footer totals row
      const footerRow = el('div', {
        class: 'task-row-footer',
        style: 'display: grid; grid-template-columns: 36px minmax(180px, 2fr) minmax(160px, 1.5fr) 110px 120px 100px 110px 80px 100px; font-weight: bold; border-top: 2px solid var(--border); padding: 12px 16px;'
      });
      for (let i = 0; i < 7; i++) {
        footerRow.appendChild(el('div'));
      }
      footerRow.appendChild(el('div', { text: `${totalHours} hrs` }));
      footerRow.appendChild(el('div'));
      groupEl.appendChild(footerRow);

      listWrapper.appendChild(groupEl);
    }

    await updateBulkBar();
    };

    await renderGroups();

    container.appendChild(listWrapper);

    // Related Financials & Documents (Redesign card pattern)
    const relatedSection = el('div', { class: 'card', style: 'margin-top: 32px;' });
    const relatedHeader = el('div', { class: 'card-header' });
    relatedHeader.appendChild(el('div', { class: 'card-title', text: 'Related Financials & Documents' }));
    relatedSection.appendChild(relatedHeader);

    const grid = el('div', { class: 'financials-grid' });

    // Fetch related records
    const wrRelated = WorkflowData.getRelatedForWorkRequest(wr.id);
    const approvedInvs = wrRelated.invoices;
    const pendingInvs = WorkflowData.getPendingApprovalsWhere(pc => {
      if (pc.table !== 'invoices' || pc.status !== 'pending') return false;
      const inv = pc.proposedData;
      return inv && (inv.workRequestId === wr.id || wr.linkedInvoiceId === inv.id);
    }).map(pc => {
      const inv = deepClone(pc.proposedData);
      inv.status = 'Pending';
      inv.pendingChangeId = pc.id;
      return inv;
    });

    const seenIds = new Set();
    const invoices = [];
    [...approvedInvs, ...pendingInvs].forEach(inv => {
      if (!seenIds.has(inv.id)) {
        seenIds.add(inv.id);
        invoices.push(inv);
      }
    });

    const disbursements = wrRelated.disbursements;
    const transmittals = wrRelated.transmittals;

    // Invoices Column
    const invCol = el('div', { class: 'financial-card' });
    invCol.appendChild(el('h4', { text: '📄 Invoices / Billings' }));
    if (invoices.length === 0) {
      invCol.appendChild(renderEmptyStateV2({
        variant: 'card-empty',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
        title: 'No linked invoices',
        body: 'Billings linked to this work request will appear here.'
      }));
    } else {
      const invList = el('div', { style: 'display: flex; flex-direction: column; gap: 8px;' });
      invoices.forEach(inv => {
        const item = el('div', { style: 'display: flex; justify-content: space-between; align-items: center; font-size: 0.8125rem; background: var(--bg); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); border: 1px solid var(--border);' });
        const left = el('div');
        const link = el('a', { href: 'javascript:void(0)', text: inv.invoiceNumber, style: 'color: var(--accent); font-weight: 600; text-decoration: none;' });
        link.addEventListener('click', (e) => { e.stopPropagation(); location.hash = '#billing/detail/' + inv.id; });
        link.addEventListener('mouseenter', () => { link.style.textDecoration = 'underline'; });
        link.addEventListener('mouseleave', () => { link.style.textDecoration = 'none'; });
        left.appendChild(link);
        
        let scopeText = ' (Entire WR)';
        if (inv.linkedTaskId) {
          const task = WorkflowData.getTaskById(inv.linkedTaskId);
          if (task) scopeText = ` (Task: ${task.title})`;
        }
        left.appendChild(el('span', { text: scopeText, style: 'color: var(--muted); font-size: var(--text-xs); font-style: italic;' }));
        left.appendChild(el('div', { text: `${formatDate(inv.issueDate)} • ${formatPHP(inv.total)}`, style: 'color: var(--muted); font-size: var(--text-xs); margin-top: 2px;' }));
        
        item.appendChild(left);
        
        let bg = 'var(--bg)';
        let fg = 'var(--muted)';
        if (inv.status === 'Paid') { bg = 'color-mix(in oklab, var(--success), transparent 88%)'; fg = 'var(--success)'; }
        else if (inv.status === 'Approved') { bg = 'color-mix(in oklab, var(--accent), transparent 88%)'; fg = 'var(--accent)'; }
        else if (inv.status === 'Sent') { bg = 'color-mix(in oklab, var(--accent), transparent 92%)'; fg = 'var(--accent)'; }
        else if (inv.status === 'Pending') { bg = 'color-mix(in oklab, var(--warn), transparent 88%)'; fg = 'color-mix(in oklab, var(--warn), black 30%)'; }
        else if (inv.status === 'Draft') { bg = 'var(--bg)'; fg = 'var(--muted)'; }

        const stBadge = el('span', { 
          class: 'badge', 
          text: inv.status, 
          style: `font-size: 10px; padding: 2px 6px; border-radius: 12px; background: ${bg}; color: ${fg};`
        });
        item.appendChild(stBadge);
        invList.appendChild(item);
      });
      invCol.appendChild(invList);
    }

    grid.appendChild(invCol);

    // Disbursements Column
    const disbCol = el('div', { class: 'financial-card' });
    disbCol.appendChild(el('h4', { text: '💸 Expenses / Disbursements' }));
    if (disbursements.length === 0) {
      disbCol.appendChild(renderEmptyStateV2({
        variant: 'card-empty',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle></svg>',
        title: 'No linked disbursements',
        body: 'Expenses and fund releases linked to this work request will appear here.'
      }));
    } else {
      const disbList = el('div', { style: 'display: flex; flex-direction: column; gap: 8px;' });
      disbursements.forEach(d => {
        const item = el('div', { style: 'display: flex; justify-content: space-between; align-items: center; font-size: 0.8125rem; background: var(--bg); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); border: 1px solid var(--border);' });
        const left = el('div');
        const link = el('a', { href: 'javascript:void(0)', text: d.category, style: 'color: var(--accent); font-weight: 600; text-decoration: none;' });
        link.addEventListener('click', (e) => { e.stopPropagation(); location.hash = '#disbursement/detail/' + d.id; });
        link.addEventListener('mouseenter', () => { link.style.textDecoration = 'underline'; });
        link.addEventListener('mouseleave', () => { link.style.textDecoration = 'none'; });
        left.appendChild(link);
        
        let scopeText = ' (Entire WR)';
        if (d.linkedTaskId) {
          const task = WorkflowData.getTaskById(d.linkedTaskId);
          if (task) scopeText = ` (Task: ${task.title})`;
        }
        left.appendChild(el('span', { text: scopeText, style: 'color: var(--muted); font-size: var(--text-xs); font-style: italic;' }));
        left.appendChild(el('div', { text: `${formatDate(d.submittedAt)} • ${formatPHP(d.amount)}`, style: 'color: var(--muted); font-size: var(--text-xs); margin-top: 2px;' }));
        
        item.appendChild(left);
        const stBadge = el('span', { 
          class: 'badge', 
          text: d.status, 
          style: `font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm); background: ${d.status === 'Released' ? 'color-mix(in oklab, var(--success), transparent 88%)' : d.status === 'Approved' ? 'color-mix(in oklab, var(--accent), transparent 88%)' : 'color-mix(in oklab, var(--warn), transparent 88%)'}; color: ${d.status === 'Released' ? 'var(--success)' : d.status === 'Approved' ? 'var(--accent)' : 'color-mix(in oklab, var(--warn), black 30%)'};`
        });
        item.appendChild(stBadge);
        disbList.appendChild(item);
      });
      disbCol.appendChild(disbList);
    }
    grid.appendChild(disbCol);

    // Transmittals Column
    const transCol = el('div', { class: 'financial-card' });
    transCol.appendChild(el('h4', { text: '📦 Transmittals' }));
    if (transmittals.length === 0) {
      transCol.appendChild(renderEmptyStateV2({
        variant: 'card-empty',
        icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>',
        title: 'No linked transmittals',
        body: 'Transmittals linked to this work request will appear here.'
      }));
    } else {
      const transList = el('div', { style: 'display: flex; flex-direction: column; gap: 8px;' });
      transmittals.forEach(t => {
        const item = el('div', { style: 'display: flex; justify-content: space-between; align-items: center; font-size: 0.8125rem; background: var(--bg); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); border: 1px solid var(--border);' });
        const left = el('div');
        const link = el('a', { href: 'javascript:void(0)', text: t.trackingNumber, style: 'color: var(--accent); font-weight: 600; text-decoration: none;' });
        link.addEventListener('click', (e) => { e.stopPropagation(); location.hash = '#transmittal/detail/' + t.id; });
        link.addEventListener('mouseenter', () => { link.style.textDecoration = 'underline'; });
        link.addEventListener('mouseleave', () => { link.style.textDecoration = 'none'; });
        left.appendChild(link);
        left.appendChild(el('div', { text: `Sent: ${formatDate(t.sentAt)}`, style: 'color: var(--muted); font-size: var(--text-xs); margin-top: 2px;' }));
        
        item.appendChild(left);
        const stBadge = el('span', { 
          class: 'badge', 
          text: t.status, 
          style: `font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm); background: ${t.status === 'Acknowledged' ? 'color-mix(in oklab, var(--success), transparent 88%)' : 'var(--bg)'}; color: ${t.status === 'Acknowledged' ? 'var(--success)' : 'var(--muted)'};`
        });
        item.appendChild(stBadge);
        transList.appendChild(item);
      });
      transCol.appendChild(transList);
    }
    grid.appendChild(transCol);

    relatedSection.appendChild(grid);
    container.appendChild(relatedSection);

    return container;
  },

  async showLinkFinancialModal(taskId) {
    const task = WorkflowData.getTaskById(taskId);
    if (!task) return;
    const wr = WorkflowData.getWorkRequestById(task.workRequestId);

    let clientInvoices = [];
    let availableDisbursements = [];
    try {
      const invRes = await window.apiClient.invoices.list({ clientId: wr?.clientId, status: '!Cancelled' });
      clientInvoices = (invRes?.data || []).filter(inv => !inv.linkedTaskId);
    } catch (e) {
      console.error('[Workflow] failed to load invoices for link modal', e);
    }
    try {
      const disbRes = await window.apiClient.disbursements.list({ status: '!Cancelled' });
      availableDisbursements = (disbRes?.data || []).filter(d => !d.linkedTaskId);
    } catch (e) {
      console.error('[Workflow] failed to load disbursements for link modal', e);
    }

    const form = el('form', { class: 'form-stacked' });
    
    // Type Select
    const typeGroup = el('div', { class: 'form-group' });
    typeGroup.appendChild(el('label', { text: 'Record Type *' }));
    const typeSel = el('select', { required: true });
    typeSel.appendChild(el('option', { value: '', text: '— Select Type —' }));
    typeSel.appendChild(el('option', { value: 'invoice', text: 'Service Invoice (Billing)' }));
    typeSel.appendChild(el('option', { value: 'disbursement', text: 'Expense / Disbursement' }));
    typeGroup.appendChild(typeSel);
    form.appendChild(typeGroup);

    // Record Select
    const recGroup = el('div', { class: 'form-group' });
    recGroup.appendChild(el('label', { text: 'Select Record *' }));
    const recSel = el('select', { required: true, disabled: true });
    recGroup.appendChild(recSel);
    form.appendChild(recGroup);

    typeSel.addEventListener('change', () => {
      recSel.innerHTML = '';
      recSel.disabled = false;
      if (typeSel.value === 'invoice') {
        if (clientInvoices.length === 0) {
          recSel.appendChild(el('option', { value: '', text: 'No available invoices for this client' }));
          recSel.disabled = true;
        } else {
          clientInvoices.forEach(inv => recSel.appendChild(el('option', { value: inv.id, text: `${inv.invoiceNumber || inv.invoice_number} (${formatPHP(inv.total)})` })));
        }
      } else if (typeSel.value === 'disbursement') {
        // Disbursements might not be strictly tied to client, but let's just show those not linked to a task
        if (availableDisbursements.length === 0) {
          recSel.appendChild(el('option', { value: '', text: 'No available disbursements' }));
          recSel.disabled = true;
        } else {
          availableDisbursements.forEach(d => recSel.appendChild(el('option', { value: d.id, text: `${d.category} - ${formatPHP(d.amount)}` })));
        }
      } else {
        recSel.disabled = true;
      }
    });

    const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Link Record' });
    form.appendChild(submitBtn);

    const overlay = this.showModal('Link Financial Record', form, null);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const recId = recSel.value;
      if (!recId) return;

      try {
        if (typeSel.value === 'invoice') {
          await window.apiClient.invoices.update(recId, { linkedTaskId: taskId, workRequestId: task.workRequestId });
        } else if (typeSel.value === 'disbursement') {
          await window.apiClient.disbursements.update(recId, { linkedTaskId: taskId, linkedWorkRequestId: task.workRequestId });
        }
        WorkflowData.invalidateRelatedForWorkRequest(task.workRequestId);
        WorkflowData.invalidateRelatedForTask(taskId);
      } catch (err) {
        console.error('Failed to link financial record', err);
        this.showMessage('Error', 'Failed to link record: ' + (err.message || 'Unknown error'), 'danger');
        return;
      }
      overlay.remove();
      App.handleRoute();
    });
  },

  async uploadTaskDocument(taskId, file, options = {}) {
    if (file.size > 50 * 1024 * 1024) {
      this.showMessage('File Too Large', 'Files must be 50 MB or smaller.', 'warning');
      throw new Error('File size exceeds 50 MB limit');
    }

    const task = WorkflowData.getTaskById(taskId);
    if (!task) throw new Error('Task not found');

    const metadata = {
      fileName: file.name,
      originalName: file.name,
      contentType: file.type || 'application/octet-stream',
      fileSize: file.size,
      documentType: options.documentType || 'original_scan',
      category: options.category || 'OTHER',
      description: options.description || `Uploaded via task: ${task.title}`,
      workRequestId: task.workRequestId,
      linkedTaskId: taskId,
    };

    const createRes = await window.apiClient.documents.create(metadata);
    const { document: dmsDoc, uploadUrl } = createRes.data;

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': metadata.contentType },
      body: file,
    });
    if (!uploadRes.ok) {
      throw new Error(`Storage upload failed: ${uploadRes.status}`);
    }

    await window.apiClient.documents.confirmUpload(dmsDoc.id);

    const entry = {
      documentId: dmsDoc.id,
      fileName: file.name,
      uploadDate: new Date().toISOString().slice(0, 10),
      uploaderId: Auth.user.id,
    };
    const updatedDocs = [...(task.taskDocuments || []), entry];
    await WorkflowData.updateTask(taskId, { taskDocuments: updatedDocs, updatedAt: new Date().toISOString() });

    WorkflowData.invalidateRelatedForWorkRequest(task.workRequestId);
    return dmsDoc;
  },

  async linkTaskDocument(taskId, linkUrl, options = {}) {
    const task = WorkflowData.getTaskById(taskId);
    if (!task) throw new Error('Task not found');

    let fileName = options.fileName || 'Linked Document';
    if (options.isGoogleDrive) {
      fileName = options.fileName || 'GDrive Document';
    } else if (options.isFigma) {
      fileName = options.fileName || 'Figma Design File';
    }

    const metadata = {
      fileName: fileName,
      originalName: fileName,
      documentType: options.documentType || 'original_scan',
      category: options.category || 'OTHER',
      description: options.description || `${options.isGoogleDrive ? 'GDrive link' : options.isFigma ? 'Figma link' : 'Linked'} via task: ${task.title}`,
      workRequestId: task.workRequestId,
      linkedTaskId: taskId,
      externalUrl: linkUrl
    };

    const createRes = await window.apiClient.documents.create(metadata);
    const dmsDoc = createRes.data.document;

    const entry = {
      documentId: dmsDoc.id,
      fileName: fileName,
      uploadDate: new Date().toISOString().slice(0, 10),
      uploaderId: Auth.user.id,
      linkUrl: linkUrl
    };
    if (options.isGoogleDrive) {
      entry.isGoogleDrive = true;
    }
    if (options.isFigma) {
      entry.isFigma = true;
      entry.figmaUrl = linkUrl;
    }
    const updatedDocs = [...(task.taskDocuments || []), entry];
    await WorkflowData.updateTask(taskId, { taskDocuments: updatedDocs, updatedAt: new Date().toISOString() });

    WorkflowData.invalidateRelatedForWorkRequest(task.workRequestId);
    return dmsDoc;
  },

  async showDocumentPreview(documentId) {
    try {
      const docRes = await window.apiClient.documents.get(documentId);
      const doc = docRes.data;

      let url = '';
      let fileName = doc.original_name || doc.file_name || 'Document';

      if (!doc.external_url) {
        const urlRes = await window.apiClient.documents.downloadUrl(documentId);
        url = urlRes.data.url;
        fileName = urlRes.data.fileName || fileName;
      }

      const overlay = el('div', { class: 'document-preview-overlay' });
      const pane = el('div', { class: 'document-preview-pane' });
      const header = el('div', { class: 'document-preview-header' });

      const titleSpan = el('h3', { text: fileName, class: 'document-preview-title' });
      header.appendChild(titleSpan);

      if (!doc.external_url) {
        const downloadBtn = el('a', {
          href: url,
          download: fileName,
          class: 'btn btn-primary btn-sm',
          text: 'Download',
          target: '_blank',
          style: 'margin-right: 8px;'
        });
        header.appendChild(downloadBtn);
      }

      const closeBtn = el('button', { class: 'btn btn-ghost btn-sm', text: 'Close' });
      closeBtn.addEventListener('click', () => overlay.remove());
      header.appendChild(closeBtn);

      const viewer = el('div', { class: 'document-preview-viewer' });
      const contentType = doc.content_type || '';

      if (doc.external_url) {
        const extUrl = doc.external_url;
        if (extUrl.includes('figma.com')) {
          viewer.innerHTML = `<iframe src="https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(extUrl)}" allowfullscreen style="width:100%; height:100%; border:none;"></iframe>`;
        } else if (extUrl.includes('drive.google.com') || extUrl.includes('docs.google.com') || extUrl === 'mock-google-drive-data-url') {
          viewer.innerHTML = `<iframe src="${extUrl}" allowfullscreen style="width:100%; height:100%; border:none;"></iframe>`;
        } else {
          viewer.appendChild(el('div', { class: 'document-preview-fallback', style: 'padding: 20px; text-align: center;' }, [
            el('p', { text: 'This is a linked document.', style: 'margin-bottom: 12px;' }),
            el('a', { href: extUrl, target: '_blank', text: 'Open Link', class: 'btn btn-primary' })
          ]));
        }
      } else if (contentType.startsWith('image/')) {
        viewer.appendChild(el('img', { src: url, alt: fileName, style: 'max-width:100%; max-height:100%; object-fit:contain;' }));
      } else if (contentType === 'application/pdf') {
        viewer.innerHTML = `<iframe src="${url}" frameborder="0" allowfullscreen style="width:100%; height:100%; border:none;"></iframe>`;
      } else {
        viewer.appendChild(el('div', { class: 'document-preview-fallback', style: 'padding: 20px; text-align: center;' }, [
          el('p', { text: 'Preview not available for this file type.', style: 'margin-bottom: 12px;' }),
          el('a', { href: url, download: fileName, text: 'Download to View', class: 'btn btn-primary', target: '_blank' })
        ]));
      }

      function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      }

      const meta = el('div', { class: 'document-preview-meta' });
      if (!doc.external_url) {
        meta.appendChild(el('span', { text: `Type: ${contentType || 'unknown'}` }));
        meta.appendChild(el('span', { text: `Size: ${formatBytes(doc.file_size || 0)}` }));
      } else {
        meta.appendChild(el('span', { text: `Type: Link Attachment` }));
      }
      meta.appendChild(el('span', { text: `Uploaded: ${formatDate(doc.created_at)}` }));

      pane.appendChild(header);
      pane.appendChild(viewer);
      pane.appendChild(meta);
      overlay.appendChild(pane);

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
        }
      });

      document.body.appendChild(overlay);
    } catch (err) {
      console.error('Failed to load document preview', err);
      this.showMessage('Preview Error', 'Failed to load preview: ' + (err.message || 'Unknown error'), 'danger');
    }
  },

  async showAddDocumentModal(taskId, triggerEl) {
    const task = WorkflowData.getTaskById(taskId);
    if (!task) return;

    // Remove any existing popover
    const existing = document.querySelector('.notion-embed-popover');
    if (existing) existing.remove();

    const popover = el('div', { class: 'notion-embed-popover' });

    // Header: Title + Close button
    const header = el('div', { class: 'notion-popover-header' });
    header.appendChild(el('span', { class: 'notion-popover-title', text: 'Add Document' }));
    const closeBtn = el('button', { class: 'notion-popover-close', text: '✕' });
    closeBtn.addEventListener('click', () => popover.remove());
    header.appendChild(closeBtn);
    popover.appendChild(header);

    // Create tabs header
    const tabsHeader = el('div', { class: 'notion-popover-tabs' });
    const contentArea = el('div', { class: 'notion-popover-content' });

    let activeTab = 'upload'; // upload, link, gdrive

    const renderContent = () => {
      contentArea.innerHTML = '';

      if (activeTab === 'upload') {
        const panel = el('div', { class: 'notion-popover-panel' });
        
        // Drag-and-drop zone
        const dropzone = el('div', { class: 'notion-popover-dropzone' });
        dropzone.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div>Drag & drop file here, or click to browse</div>
          <div style="font-size: 10px; color: var(--color-text-muted);">Max size: 50MB</div>
        `;

        const fileInput = el('input', { type: 'file', style: 'display: none;' });
        panel.appendChild(fileInput);
        panel.appendChild(dropzone);

        const statusLabel = el('div', { style: 'font-size: 0.75rem; text-align: center; margin-top: 8px;' });
        const errorLabel = el('div', { style: 'font-size: 0.75rem; text-align: center; margin-top: 8px; color: var(--color-danger); font-weight: 500;' });
        const uploadBtn = el('button', { class: 'notion-popover-submit', text: 'Upload file', style: 'margin-top: 8px; display: none;' });
        
        panel.appendChild(statusLabel);
        panel.appendChild(errorLabel);
        panel.appendChild(uploadBtn);

        let selectedFile = null;

        const handleFile = (file) => {
          errorLabel.textContent = '';
          statusLabel.textContent = '';
          uploadBtn.style.display = 'none';
          selectedFile = null;

          if (!file) return;

          // Validate file size (50MB)
          const limit = 50 * 1024 * 1024;
          if (file.size > limit) {
            errorLabel.textContent = 'Error: File exceeds the 50MB size limit.';
            fileInput.value = '';
            return;
          }

          selectedFile = file;
          const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
          statusLabel.innerHTML = `<span style="font-weight: 600; color: var(--color-text);">${file.name}</span> (${sizeMB} MB)`;
          uploadBtn.style.display = 'flex';
        };

        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
          handleFile(fileInput.files[0]);
        });

        dropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', () => {
          dropzone.classList.remove('dragover');
        });
        dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('dragover');
          if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
          }
        });

        uploadBtn.addEventListener('click', async () => {
          if (!selectedFile) return;
          uploadBtn.disabled = true;
          uploadBtn.textContent = 'Uploading...';
          try {
            await this.uploadTaskDocument(taskId, selectedFile, { category: 'OTHER' });
            popover.remove();
            this.showTaskSidePane(taskId, null);
            App.handleRoute();
          } catch (err) {
            console.error('Failed to upload document', err);
            errorLabel.textContent = 'Upload Failed: ' + (err.message || 'Unknown error');
            uploadBtn.disabled = false;
            uploadBtn.textContent = 'Upload file';
          }
        });

        contentArea.appendChild(panel);
      } else if (activeTab === 'link') {
        const panel = el('div', { class: 'notion-popover-panel' });
        const linkInput = el('input', { type: 'text', class: 'notion-popover-input', placeholder: 'Paste in link...' });
        const submitBtn = el('button', { class: 'notion-popover-submit', text: 'Link file' });
        
        submitBtn.addEventListener('click', async () => {
          const val = linkInput.value.trim();
          if (!val) return;

          let fileName = 'Linked Document';
          try {
            const url = new URL(val);
            const pathParts = url.pathname.split('/');
            const lastPart = pathParts[pathParts.length - 1];
            if (lastPart && lastPart.includes('.')) {
              fileName = lastPart;
            }
          } catch(e) {}

          submitBtn.disabled = true;
          submitBtn.textContent = 'Linking...';

          try {
            await this.linkTaskDocument(taskId, val, { fileName, category: 'OTHER' });
            popover.remove();
            this.showTaskSidePane(taskId, null);
            App.handleRoute();
          } catch (err) {
            console.error('Failed to link document', err);
            this.showMessage('Link Error', 'Failed to link document: ' + (err.message || 'Unknown error'), 'danger');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Link file';
          }
        });
        
        panel.appendChild(linkInput);
        panel.appendChild(submitBtn);
        contentArea.appendChild(panel);
      } else if (activeTab === 'gdrive') {
        const panel = el('div', { class: 'notion-popover-panel' });
        
        // Link GDrive URL
        const linkInput = el('input', { type: 'text', class: 'notion-popover-input', placeholder: 'Paste Google Drive URL...' });
        const submitBtn = el('button', { class: 'notion-popover-submit', text: 'Link GDrive File' });
        
        submitBtn.addEventListener('click', async () => {
          const val = linkInput.value.trim();
          if (!val) return;

          let fileName = 'GDrive Document';
          try {
            const url = new URL(val);
            const pathParts = url.pathname.split('/');
            const lastPart = pathParts[pathParts.length - 1];
            if (lastPart && lastPart.includes('.')) {
              fileName = lastPart;
            }
          } catch(e) {}

          submitBtn.disabled = true;
          submitBtn.textContent = 'Linking...';

          try {
            await this.linkTaskDocument(taskId, val, { fileName, isGoogleDrive: true, category: 'OTHER' });
            popover.remove();
            this.showTaskSidePane(taskId, null);
            App.handleRoute();
          } catch (err) {
            console.error('Failed to link GDrive document', err);
            this.showMessage('Link Error', 'Failed to link Google Drive document: ' + (err.message || 'Unknown error'), 'danger');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Link GDrive File';
          }
        });

        // Or choose from list divider
        const divider = el('div', { 
          text: 'or choose from Google Drive', 
          style: 'font-size: 0.6875rem; color: var(--color-text-muted); text-align: center; margin: 8px 0; border-top: 1px solid var(--color-border); padding-top: 8px;' 
        });

        // Browse Google Drive panel
        const fileList = el('div', { class: 'notion-popover-file-list' });
        const driveFiles = [
          { name: 'Operations_Handbook.pdf', size: '2.4 MB' },
          { name: 'Q2_Strategy_Presentation.pdf', size: '5.1 MB' },
          { name: 'WR_Vendor_Contracts.xlsx', size: '1.2 MB' },
          { name: 'Client_Receipts_Archive.zip', size: '15.8 MB' }
        ];
        
        driveFiles.forEach(f => {
          const item = el('div', { class: 'notion-popover-file-item' });
          item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="color: #22c55e;"><path d="M2.5 17h19M4.5 14l3.5-6h8l3.5 6M9 9h6M12 3v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span style="font-weight: 500;">${f.name}</span>
            </div>
            <span style="font-size: 0.75rem; color: var(--color-text-muted);">${f.size}</span>
          `;
          item.addEventListener('click', async () => {
            try {
              await this.linkTaskDocument(taskId, 'https://docs.google.com/document/d/123456/preview', {
                fileName: f.name,
                isGoogleDrive: true,
                category: 'OTHER'
              });
              popover.remove();
              this.showTaskSidePane(taskId, null);
              App.handleRoute();
            } catch (err) {
              console.error('Failed to embed GDrive document', err);
              this.showMessage('Embed Error', 'Failed to embed Google Drive document: ' + (err.message || 'Unknown error'), 'danger');
            }
          });
          fileList.appendChild(item);
        });

        panel.appendChild(linkInput);
        panel.appendChild(submitBtn);
        panel.appendChild(divider);
        panel.appendChild(fileList);
        contentArea.appendChild(panel);
      }
    };

    // Build tabs
    const tab1Btn = el('button', { class: 'notion-tab-btn active', text: 'Upload' });
    const tab2Btn = el('button', { class: 'notion-tab-btn', text: 'Link' });
    const tab3Btn = el('button', { class: 'notion-tab-btn', text: 'Google Drive' });

    tab1Btn.addEventListener('click', () => {
      if (activeTab === 'upload') return;
      activeTab = 'upload';
      tab1Btn.classList.add('active');
      tab2Btn.classList.remove('active');
      tab3Btn.classList.remove('active');
      renderContent();
    });

    tab2Btn.addEventListener('click', () => {
      if (activeTab === 'link') return;
      activeTab = 'link';
      tab2Btn.classList.add('active');
      tab1Btn.classList.remove('active');
      tab3Btn.classList.remove('active');
      renderContent();
    });

    tab3Btn.addEventListener('click', () => {
      if (activeTab === 'gdrive') return;
      activeTab = 'gdrive';
      tab3Btn.classList.add('active');
      tab1Btn.classList.remove('active');
      tab2Btn.classList.remove('active');
      renderContent();
    });

    tabsHeader.appendChild(tab1Btn);
    tabsHeader.appendChild(tab2Btn);
    tabsHeader.appendChild(tab3Btn);

    popover.appendChild(tabsHeader);
    popover.appendChild(contentArea);

    document.body.appendChild(popover);
    renderContent();

    // Position popover with edge awareness
    const position = () => {
      const popoverWidth = 360;
      if (!triggerEl) {
        popover.style.position = 'fixed';
        popover.style.left = '50%';
        popover.style.top = '50%';
        popover.style.transform = 'translate(-50%, -50%)';
        return;
      }
      
      const triggerRect = triggerEl.getBoundingClientRect();
      
      let left = triggerRect.left + window.scrollX;
      let top = triggerRect.bottom + window.scrollY + 6;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      if (left + popoverWidth > viewportWidth - 16) {
        left = viewportWidth - popoverWidth - 16;
      }
      if (left < 16) {
        left = 16;
      }
      
      const popoverHeight = popover.offsetHeight || 280;
      if (triggerRect.bottom + popoverHeight > viewportHeight - 16) {
        top = triggerRect.top + window.scrollY - popoverHeight - 6;
      }
      
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };
    
    position();
    requestAnimationFrame(position);

    // Click outside handler
    const onMouseDown = (e) => {
      if (!popover.contains(e.target) && (!triggerEl || !triggerEl.contains(e.target))) {
        popover.remove();
        document.removeEventListener('mousedown', onMouseDown);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
  },

  async showAttachmentPopover(taskId, triggerEl, mode) {
    const task = WorkflowData.getTaskById(taskId);
    if (!task) return;
    const wr = WorkflowData.getWorkRequestById(task.workRequestId);

    // Remove any existing popover
    const existing = document.querySelector('.notion-embed-popover');
    if (existing) existing.remove();

    const popover = el('div', { class: 'notion-embed-popover' });
    
    // Create tabs header
    const tabsHeader = el('div', { class: 'notion-popover-tabs' });
    const contentArea = el('div', { class: 'notion-popover-content' });
    
    let activeTab = 'tab1';
    
    const renderContent = () => {
      contentArea.innerHTML = '';
      if (mode === 'upload') {
        if (activeTab === 'tab1') {
          // Upload panel
          const panel = el('div', { class: 'notion-popover-panel' });
          const fileInput = el('input', { type: 'file', style: 'display: none;' });
          const chooseBtn = el('button', { class: 'notion-popover-submit', text: 'Choose a file' });
          
          chooseBtn.addEventListener('click', () => fileInput.click());
          fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;

            chooseBtn.disabled = true;
            chooseBtn.textContent = 'Uploading...';

            try {
              await this.uploadTaskDocument(taskId, file, { category: 'OTHER' });
              popover.remove();
              this.showTaskSidePane(taskId, null);
              App.handleRoute();
            } catch (err) {
              console.error('Failed to upload document', err);
              this.showMessage('Upload Error', 'Failed to upload document: ' + (err.message || 'Unknown error'), 'danger');
              chooseBtn.disabled = false;
              chooseBtn.textContent = 'Choose a file';
            }
          });
          
          panel.appendChild(fileInput);
          panel.appendChild(chooseBtn);
          contentArea.appendChild(panel);
        } else {
          // Link panel
          const panel = el('div', { class: 'notion-popover-panel' });
          const linkInput = el('input', { type: 'text', class: 'notion-popover-input', placeholder: 'Paste in link...' });
          const submitBtn = el('button', { class: 'notion-popover-submit', text: 'Link file' });
          
          submitBtn.addEventListener('click', async () => {
            const val = linkInput.value.trim();
            if (!val) return;

            let fileName = 'Linked Document';
            try {
              const url = new URL(val);
              const pathParts = url.pathname.split('/');
              const lastPart = pathParts[pathParts.length - 1];
              if (lastPart && lastPart.includes('.')) {
                fileName = lastPart;
              }
            } catch(e) {}

            submitBtn.disabled = true;
            submitBtn.textContent = 'Linking...';

            try {
              await this.linkTaskDocument(taskId, val, { fileName, category: 'OTHER' });
              popover.remove();
              this.showTaskSidePane(taskId, null);
              App.handleRoute();
            } catch (err) {
              console.error('Failed to link document', err);
              this.showMessage('Link Error', 'Failed to link document: ' + (err.message || 'Unknown error'), 'danger');
              submitBtn.disabled = false;
              submitBtn.textContent = 'Link file';
            }
          });
          
          panel.appendChild(linkInput);
          panel.appendChild(submitBtn);
          contentArea.appendChild(panel);
        }
      } else {
        // GDrive mode
        if (activeTab === 'tab1') {
          // Link GDrive panel
          const panel = el('div', { class: 'notion-popover-panel' });
          const linkInput = el('input', { type: 'text', class: 'notion-popover-input', placeholder: 'Paste in https://...' });
          const submitBtn = el('button', { class: 'notion-popover-submit', text: 'Embed Google Drive file' });
          const hint = el('div', { class: 'notion-popover-hint', text: 'Works with any file in your Google Drive' });
          
          submitBtn.addEventListener('click', async () => {
            const val = linkInput.value.trim();
            if (!val) return;

            let fileName = 'GDrive Document';
            try {
              const url = new URL(val);
              const pathParts = url.pathname.split('/');
              const lastPart = pathParts[pathParts.length - 1];
              if (lastPart && lastPart.includes('.')) {
                fileName = lastPart;
              }
            } catch(e) {}

            submitBtn.disabled = true;
            submitBtn.textContent = 'Linking...';

            try {
              await this.linkTaskDocument(taskId, val, { fileName, isGoogleDrive: true, category: 'OTHER' });
              popover.remove();
              this.showTaskSidePane(taskId, null);
              App.handleRoute();
            } catch (err) {
              console.error('Failed to link GDrive document', err);
              this.showMessage('Link Error', 'Failed to link Google Drive document: ' + (err.message || 'Unknown error'), 'danger');
              submitBtn.disabled = false;
              submitBtn.textContent = 'Embed Google Drive file';
            }
          });
          
          panel.appendChild(linkInput);
          panel.appendChild(submitBtn);
          panel.appendChild(hint);
          contentArea.appendChild(panel);
        } else {
          // Browse Google Drive panel
          const panel = el('div', { class: 'notion-popover-panel' });
          const fileList = el('div', { class: 'notion-popover-file-list' });
          
          const driveFiles = [
            { name: 'Operations_Handbook.pdf', size: '2.4 MB' },
            { name: 'Q2_Strategy_Presentation.pdf', size: '5.1 MB' },
            { name: 'WR_Vendor_Contracts.xlsx', size: '1.2 MB' },
            { name: 'Client_Receipts_Archive.zip', size: '15.8 MB' }
          ];
          
          driveFiles.forEach(f => {
            const item = el('div', { class: 'notion-popover-file-item' });
            item.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="color: #22c55e;"><path d="M2.5 17h19M4.5 14l3.5-6h8l3.5 6M9 9h6M12 3v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span style="font-weight: 500;">${f.name}</span>
              </div>
              <span style="font-size: 0.75rem; color: var(--color-text-muted);">${f.size}</span>
            `;
            item.addEventListener('click', async () => {
              try {
                await this.linkTaskDocument(taskId, 'mock-google-drive-data-url', {
                  fileName: f.name,
                  isGoogleDrive: true,
                  category: 'OTHER'
                });
                popover.remove();
                this.showTaskSidePane(taskId, null);
                App.handleRoute();
              } catch (err) {
                console.error('Failed to embed GDrive document', err);
                this.showMessage('Embed Error', 'Failed to embed Google Drive document: ' + (err.message || 'Unknown error'), 'danger');
              }
            });
            fileList.appendChild(item);
          });
          panel.appendChild(fileList);
          contentArea.appendChild(panel);
        }
      }
    };

    // Build tabs
    const tab1Label = mode === 'upload' ? 'Upload' : 'Link';
    const tab2Label = mode === 'upload' ? 'Link' : 'Browse Google Drive';
    
    const tab1Btn = el('button', { class: 'notion-tab-btn active', text: tab1Label });
    const tab2Btn = el('button', { class: 'notion-tab-btn', text: tab2Label });
    
    tab1Btn.addEventListener('click', () => {
      if (activeTab === 'tab1') return;
      activeTab = 'tab1';
      tab1Btn.classList.add('active');
      tab2Btn.classList.remove('active');
      renderContent();
    });
    
    tab2Btn.addEventListener('click', () => {
      if (activeTab === 'tab2') return;
      activeTab = 'tab2';
      tab2Btn.classList.add('active');
      tab1Btn.classList.remove('active');
      renderContent();
    });
    
    tabsHeader.appendChild(tab1Btn);
    tabsHeader.appendChild(tab2Btn);
    
    popover.appendChild(tabsHeader);
    popover.appendChild(contentArea);
    
    document.body.appendChild(popover);
    renderContent();
    
    // Position popover with edge awareness
    const position = () => {
      const triggerRect = triggerEl.getBoundingClientRect();
      const popoverWidth = 360;
      
      let left = triggerRect.left + window.scrollX;
      let top = triggerRect.bottom + window.scrollY + 6;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      if (left + popoverWidth > viewportWidth - 16) {
        left = viewportWidth - popoverWidth - 16;
      }
      if (left < 16) {
        left = 16;
      }
      
      const popoverHeight = popover.offsetHeight || 150;
      if (triggerRect.bottom + popoverHeight > viewportHeight - 16) {
        top = triggerRect.top + window.scrollY - popoverHeight - 6;
      }
      
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };
    
    position();
    requestAnimationFrame(position);
    
    // Click outside handler
    const onMouseDown = (e) => {
      if (!popover.contains(e.target) && !triggerEl.contains(e.target)) {
        popover.remove();
        document.removeEventListener('mousedown', onMouseDown);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
  },

  async showGoogleDriveChooser(taskId) {
    const task = WorkflowData.getTaskById(taskId);
    if (!task) return;

    const driveFiles = [
      { name: 'Operations_Handbook.pdf', size: '2.4 MB' },
      { name: 'Q2_Strategy_Presentation.pdf', size: '5.1 MB' },
      { name: 'WR_Vendor_Contracts.xlsx', size: '1.2 MB' },
      { name: 'Client_Receipts_Archive.zip', size: '15.8 MB' }
    ];
    
    const container = el('div', { style: 'display: flex; flex-direction: column; gap: 12px; padding: 8px;' });
    container.appendChild(el('p', { text: 'Select a file from your connected Google Drive to embed:', style: 'font-size: 0.875rem; color: var(--color-text-muted); margin-bottom: 8px;' }));
    
    const list = el('div', { style: 'display: flex; flex-direction: column; gap: 8px;' });
    driveFiles.forEach(f => {
      const item = el('div', { 
        style: 'display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 12px; cursor: pointer; transition: all 0.15s ease;'
      });
      item.addEventListener('mouseenter', () => {
        item.style.borderColor = 'var(--color-primary)';
        item.style.background = 'color-mix(in srgb, var(--color-primary), transparent 95%)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.borderColor = 'var(--color-border)';
        item.style.background = 'var(--color-bg)';
      });
      
      const fileLeft = el('div', { style: 'display: flex; align-items: center; gap: 10px;' });
      fileLeft.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="color: #22c55e;"><path d="M2.5 17h19M4.5 14l3.5-6h8l3.5 6M9 9h6M12 3v3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span style="font-weight: 500; font-size: 0.875rem; color: var(--color-text);">${f.name}</span>
      `;
      item.appendChild(fileLeft);
      item.appendChild(el('span', { text: f.size, style: 'font-size: 0.75rem; color: var(--color-text-muted);' }));
      
      item.addEventListener('click', async () => {
        try {
          await this.linkTaskDocument(taskId, 'mock-google-drive-data-url', {
            fileName: f.name,
            isGoogleDrive: true,
            category: 'OTHER'
          });
          overlay.remove();
          this.showTaskSidePane(taskId, null);
          App.handleRoute();
        } catch (err) {
          console.error('Failed to embed GDrive document', err);
          this.showMessage('Embed Error', 'Failed to embed Google Drive document: ' + (err.message || 'Unknown error'), 'danger');
        }
      });
      list.appendChild(item);
    });
    
    container.appendChild(list);
    const overlay = this.showModal('Google Drive File Chooser', container, null);
  },

  showFigmaEmbedModal(taskId) {
    const task = WorkflowData.getTaskById(taskId);
    if (!task) return;
    
    const container = el('div', { class: 'form-stacked', style: 'display: flex; flex-direction: column; padding: 8px;' });
    const inputGroup = el('div', { class: 'form-group' }, [
      el('label', { text: 'Figma File URL' }),
      el('input', { type: 'text', placeholder: 'https://www.figma.com/file/...', class: 'form-control', style: 'width: 100%;' })
    ]);
    container.appendChild(inputGroup);
    const input = inputGroup.querySelector('input');

    const btnRow = el('div', { style: 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;' });
    const cancelBtn = el('button', { class: 'btn btn-secondary btn-sm', text: 'Cancel' });
    const submitBtn = el('button', { class: 'btn btn-primary btn-sm', text: 'Embed' });
    
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    container.appendChild(btnRow);
    
    const overlay = this.showModal('Embed Figma File', container, null);
    
    cancelBtn.addEventListener('click', () => overlay.remove());
    submitBtn.addEventListener('click', async () => {
      const url = input.value.trim();
      if (!url) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Linking...';

      try {
        await this.linkTaskDocument(taskId, url, {
          fileName: url.startsWith('http') ? 'Figma Design File' : url,
          isFigma: true,
          category: 'OTHER'
        });
        overlay.remove();
        this.showTaskSidePane(taskId, null);
        App.handleRoute();
      } catch (err) {
        console.error('Failed to link Figma design', err);
        this.showMessage('Link Error', 'Failed to link Figma design: ' + (err.message || 'Unknown error'), 'danger');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Embed';
      }
    });
  },

  showAddTimeLogModal(taskId, checklistItemId = null) {
    const task = WorkflowData.getTaskById(taskId);
    let defaultWorkerName = '';
    if (checklistItemId) {
      const item = (task?.checklist || []).find(c => c.id === checklistItemId);
      defaultWorkerName = item?.assigneeName || task?.assigneeName || '';
    } else {
      defaultWorkerName = task?.assigneeName
        ? task.assigneeName
        : (task?.assigneeId || task?.assignedTo)
          ? (window.apiClient.userCache.getById(task.assigneeId || task.assignedTo)?.name || '')
          : '';
    }

    function nextManilaDate(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }

    const form = el('form', { class: 'form-stacked' });

    // Worker Name field
    const workerInput = el('input', { type: 'text', name: 'workerName', placeholder: 'Worker name', value: defaultWorkerName });
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Worker Name' }),
      workerInput
    ]));

    // Date field
    const dateInput = el('input', { type: 'date', name: 'date', required: true, value: manilaToday() });
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Date *' }),
      dateInput
    ]));

    // Start Time field
    const startInput = el('input', { type: 'time', name: 'start', required: true });
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Start Time *' }),
      startInput
    ]));

    // End Time field
    const endInput = el('input', { type: 'time', name: 'end', required: true });
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'End Time *' }),
      endInput
    ]));

    // Note / Activity field
    const noteInput = el('input', { type: 'text', name: 'note', placeholder: 'What did you work on?', required: false });
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Note / Activity' }),
      noteInput
    ]));

    // Hours (read-only, auto-calculated)
    const hoursInput = el('input', { type: 'text', name: 'hours', readOnly: true, value: '0.00', style: 'background: var(--bg); cursor: not-allowed;' });
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Calculated Hours' }),
      hoursInput
    ]));

    // Update hours calculation dynamically
    function updateHours() {
      const start = startInput.value;
      const end = endInput.value;
      if (start && end) {
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        const totalMin = endMin > startMin ? endMin - startMin : endMin + 1440 - startMin;
        const hours = Math.round(totalMin / 60 * 4) / 4;
        hoursInput.value = hours.toFixed(2);
      } else {
        hoursInput.value = '0.00';
      }
    }
    startInput.addEventListener('change', updateHours);
    endInput.addEventListener('change', updateHours);

    const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Save Log' });
    form.appendChild(submitBtn);

    const overlay = this.showModal('Add Time Log', form, null);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const dateVal = dateInput.value;
      const start = startInput.value;
      const end = endInput.value;
      const noteVal = noteInput.value;

      if (!dateVal || !start || !end) return;

      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      const workerName = workerInput.value.trim() || (window.apiClient.userCache.getById(Auth.user.id)?.name || '');

      let entries = [];
      if (endMin > startMin) {
        const hours = Math.round((endMin - startMin) / 60 * 4) / 4;
        if (hours > 0) entries.push({ date: dateVal, startTime: start, endTime: end, hours });
      } else {
        const hours1 = Math.round((1440 - startMin) / 60 * 4) / 4;
        const nextDate = nextManilaDate(dateVal);
        const hours2 = Math.round(endMin / 60 * 4) / 4;
        if (hours1 > 0) entries.push({ date: dateVal, startTime: start, endTime: '23:59', hours: hours1 });
        if (hours2 > 0) entries.push({ date: nextDate, startTime: '00:00', endTime: end, hours: hours2 });
      }

      if (entries.length === 0) {
        this.showMessage('Log too short', 'Log too short to record.', 'warning');
        return;
      }

      const currentTask = WorkflowData.getTaskById(taskId);
      const checklist = currentTask.checklist || [];
      const item = checklistItemId ? checklist.find(c => c.id === checklistItemId) : null;

      // Guard: prevent the same worker from logging twice on the same day for the same scope.
      // Scope is either a checklist item or the task itself.
      const scopeLogs = item ? (item.timeLogs || []) : (currentTask.timeLogs || []);
      const alreadyLogged = entries.some(entry => scopeLogs.some(l =>
        l.date === entry.date &&
        (l.workerName || '') === workerName
      ));
      if (alreadyLogged) {
        this.showMessage('Warning', `${workerName} has already logged time for this scope on one of the selected dates.`, 'warning');
        return;
      }

      const newEntries = entries.map(entry => ({
        userId: Auth.user.id,
        loggedByUserId: Auth.user.id,
        workerName,
        startTime: entry.startTime,
        endTime: entry.endTime,
        date: entry.date,
        note: noteVal,
        hours: entry.hours,
        checklistItemId: checklistItemId || null
      }));

      const updates = { updatedAt: new Date().toISOString() };
      if (item) {
        item.timeLogs = [...(item.timeLogs || []), ...newEntries];
        updates.checklist = checklist;
      } else {
        updates.timeLogs = [...(currentTask.timeLogs || []), ...newEntries];
      }
      WorkflowData.updateTask(taskId, updates);
      overlay.remove();
      App.handleRoute();
    });
  },

  async renderAddTaskForm(wrId, opts = {}) {
    const { hideHeader = false } = opts;
    await WorkflowData.loadPendingApprovals();
    let wr = WorkflowData.getWorkRequestById(wrId);
    if (!wr) {
      const pc = WorkflowData.getPendingApprovalByRecordId(wrId, 'workRequests');
      if (pc && pc.table === 'workRequests') {
        wr = { ...pc.proposedData };
        wr.id = pc.proposedData.id || pc.id;
        wr.isPendingApproval = true;
      }
    }
    if (wr && wr.isPendingApproval) {
      this.showMessage('Blocked', 'Tasks cannot be added while the Work Request is awaiting approval.', 'danger');
      return null;
    }

    const form = el('form', { id: 'add-task-form', class: 'form-stacked notion-form' });

    if (!hideHeader) {
      const headerBar = el('div', { class: 'form-header-bar' });
      const topActions = el('div', { class: 'form-actions-top' });
      const saveBtn = el('button', { type: 'submit', form: 'add-task-form', class: 'btn btn-primary', text: 'Add Task' });
      topActions.appendChild(saveBtn);
      const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel' });
      cancelBtn.addEventListener('click', () => closeFormPanelAndRoute('#operations/detail/' + wrId));
      topActions.appendChild(cancelBtn);
      headerBar.appendChild(topActions);
      form.appendChild(headerBar);
    }

    // Standard Task Template state
    let checklistItems = [];
    let checklistFromTemplate = false;
    const isDraft = wr?.status === 'Draft';

    // Standard Task Template dropdown
    const templateGroup = el('div', { class: 'form-group' });
    templateGroup.appendChild(el('label', { text: 'Standard Task Template' }));
    const templateSel = el('select', { name: 'template' });
    templateSel.appendChild(el('option', { value: '', text: '— Custom —' }));
    this.standardTaskTemplates.forEach((tmpl, idx) => {
      templateSel.appendChild(el('option', { value: String(idx), text: tmpl.title }));
    });
    templateGroup.appendChild(templateSel);
    form.appendChild(templateGroup);

    // ── Task Title free-form ──
    const titleSection = el('div', { class: 'notion-freeform notion-freeform--title' });
    const titleInput = el('input', {
      type: 'text', name: 'title', class: 'notion-freeform-input notion-title-input',
      placeholder: 'New Task', required: true
    });
    titleSection.appendChild(titleInput);
    form.appendChild(titleSection);

    // Checklist builder
    const checklistGroup = el('div', { class: 'form-group' });
    checklistGroup.appendChild(el('label', { text: 'Checklist Items' }));
    const checklistContainer = el('div', { class: 'checklist-items-container' });

    const checklistBuilder = el('div', { style: 'display:flex; gap:8px; align-items:center;' });
    const checklistInput = el('input', { type: 'text', placeholder: 'Add a checklist item...', style: 'flex:1;' });
    const checklistCategorySel = el('select', { style: 'width:110px; flex-shrink:0;' });
    checklistCategorySel.appendChild(el('option', { value: 'subtask', text: 'Sub-task' }));
    checklistCategorySel.appendChild(el('option', { value: 'document', text: 'Document' }));
    const addChecklistBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Add' });
    checklistBuilder.appendChild(checklistInput);
    checklistBuilder.appendChild(checklistCategorySel);
    checklistBuilder.appendChild(addChecklistBtn);
    checklistContainer.appendChild(checklistBuilder);
    checklistGroup.appendChild(checklistContainer);
    form.appendChild(checklistGroup);

    const renderChecklist = async () => {
      const existingList = checklistContainer.querySelector('.checklist-items-list');
      if (existingList) existingList.remove();
      if (checklistItems.length === 0) return;

      const list = el('div', { class: 'checklist-items-list', style: 'display:flex; flex-direction:column; gap:6px; margin-top:8px;' });
      for (const [idx, item] of checklistItems.entries()) {
        const row = el('div', { style: 'display:flex; align-items:center; gap:8px; padding:6px 8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius: 12px;' });
        row.appendChild(el('span', { text: item.text, style: 'flex:1; font-size:0.85rem;' }));
        const categoryBadge = el('span', {
          text: item.category === 'document' ? 'Document' : 'Sub-task',
          style: 'font-size:0.7rem; padding:2px 6px; border-radius: 12px; background:' + (item.category === 'document' ? '#dbeafe' : '#f3f4f6') + '; color:' + (item.category === 'document' ? '#1e40af' : '#4b5563') + '; font-weight:600;'
        });
        row.appendChild(categoryBadge);

        const prereqSelect = el('select', { style: 'font-size:0.8rem; max-width:140px;' });
        prereqSelect.appendChild(el('option', { value: '', text: '— None —' }));
        prereqSelect.appendChild(el('option', { value: '*', text: 'All Task (*)' }));
        checklistItems.slice(0, idx).forEach((prev, pIdx) => {
          if (!prev.id) prev.id = generateUUID();
          prereqSelect.appendChild(el('option', { value: prev.id, text: `${pIdx + 1}. ${prev.text}` }));
        });
        if (checklistItems.length <= 1) {
          prereqSelect.disabled = true;
        }
        prereqSelect.value = item.dependsOn || '';
        prereqSelect.addEventListener('change', () => {
          item.dependsOn = prereqSelect.value || null;
        });
        row.appendChild(prereqSelect);

        const assigneeDropdown = await this.createGroundWorkerDropdown({
          selectedGroundWorkerName: item.assigneeName,
          placeholder: 'Assign...',
          maxWidth: '140px',
          className: 'modal-checklist-assignee',
          onChange: ({ assigneeId, assigneeName }) => {
            item.assigneeId = assigneeId || null;
            item.assigneeName = assigneeName || null;
          }
        });
        row.appendChild(assigneeDropdown);

        const delBtn = el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: '×' });
        delBtn.addEventListener('click', async () => {
          checklistItems.splice(idx, 1);
          checklistFromTemplate = false;
          await renderChecklist();
        });
        row.appendChild(delBtn);
        list.appendChild(row);
      }
      checklistContainer.insertBefore(list, checklistBuilder);
    };

    const addChecklistItem = async () => {
      const val = checklistInput.value.trim();
      if (!val) return;
      checklistItems.push({ id: generateUUID(), text: val, category: checklistCategorySel.value || 'subtask', assigneeId: null, assigneeName: null, dependsOn: null, timeLogs: [] });
      checklistFromTemplate = false;
      checklistInput.value = '';
      await renderChecklist();
    };
    addChecklistBtn.addEventListener('click', addChecklistItem);
    checklistInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addChecklistItem();
      }
    });

    templateSel.addEventListener('change', async () => {
      const idx = parseInt(templateSel.value, 10);
      if (!isNaN(idx) && this.standardTaskTemplates[idx]) {
        const tmpl = this.standardTaskTemplates[idx];
        titleInput.value = tmpl.title;
        checklistItems = tmpl.defaultChecklist.map(item => {
          const isObj = typeof item === 'object' && item && item.text;
          return { id: generateUUID(), text: isObj ? item.text : item, category: isObj ? (item.category || 'subtask') : 'subtask', assigneeId: null, assigneeName: null, dependsOn: null, timeLogs: [] };
        });
        coAssignees = (tmpl.coAssignees || []).slice();
        checklistFromTemplate = true;
      } else {
        if (checklistFromTemplate) {
          checklistItems = [];
          coAssignees = [];
        }
        checklistFromTemplate = false;
      }
      await renderChecklist();
      renderCoAssigneeChips();
    });

    const assigneeGroup = el('div', { class: 'form-group' });
    assigneeGroup.appendChild(el('label', { text: 'Assignee' }));

    // Ground worker assignee — typable dropdown like the filter tray
    const gwDropdown = await this.createGroundWorkerDropdown({
      placeholder: 'Employee...',
      className: 'modal-task-assignee',
      onChange: () => {} // value read at submit time
    });

    const assigneeWrapper = el('div', { class: 'task-assignee-wrapper' });
    assigneeWrapper.appendChild(gwDropdown);
    assigneeGroup.appendChild(assigneeWrapper);
    form.appendChild(assigneeGroup);

    // Co-assignees
    let coAssignees = [];
    const coAssigneeGroup = el('div', { class: 'form-group' });
    coAssigneeGroup.appendChild(el('label', { text: 'Co-assignees' }));

    const coAssigneeChips = el('div', { class: 'co-assignee-chips' });
    const coAssigneeDropdown = await this.createGroundWorkerDropdown({
      placeholder: 'Add co-assignee...',
      className: 'modal-co-assignee',
      onChange: ({ assigneeName }) => {
        const name = assigneeName?.trim();
        if (!name) return;
        const primaryName = (gwDropdown.searchText || '').trim();
        if (name === primaryName) {
          coAssigneeDropdown.value = '';
          return;
        }
        if (!coAssignees.includes(name)) {
          coAssignees.push(name);
          const isUser = ((window.apiClient.userCache._users || []) || []).some(u => u.name.toLowerCase() === name.toLowerCase());
          if (!isUser) {
            this._addGroundWorker(name);
          }
          renderCoAssigneeChips();
        }
        coAssigneeDropdown.value = '';
      }
    });

    const renderCoAssigneeChips = () => {
      coAssigneeChips.innerHTML = '';
      coAssignees.forEach((name, idx) => {
        const chip = el('span', { class: 'co-assignee-chip', text: name });
        const remove = el('span', { class: 'co-assignee-chip-remove', text: '×' });
        remove.addEventListener('click', () => {
          coAssignees.splice(idx, 1);
          renderCoAssigneeChips();
        });
        chip.appendChild(remove);
        coAssigneeChips.appendChild(chip);
      });
    };

    coAssigneeGroup.appendChild(coAssigneeChips);
    coAssigneeGroup.appendChild(coAssigneeDropdown);
    if (isDraft) {
      form.appendChild(coAssigneeGroup);
    }

    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Due Date' }),
      el('input', { type: 'date', name: 'dueDate' })
    ]));

    const priorityGroup = el('div', { class: 'form-group' });
    priorityGroup.appendChild(el('label', { text: 'Priority' }));
    const prioritySel = el('select', { name: 'priority' });
    ['Priority', 'Low Priority', 'Urgent'].forEach(p => {
      prioritySel.appendChild(el('option', { value: p, text: p }));
    });
    prioritySel.value = 'Priority';
    priorityGroup.appendChild(prioritySel);
    form.appendChild(priorityGroup);

    const dependencyGroup = el('div', { class: 'form-group' });
    dependencyGroup.appendChild(el('label', { text: 'Dependency' }));

    const predWrapper = el('div', { class: 'multi-select-dropdown', style: 'width: 100%;' });
    const predBtn = el('button', { type: 'button', class: 'multi-select-btn', text: '— No dependency —', style: 'width: 100%;' });
    const predMenu = el('div', { class: 'multi-select-menu', style: 'width: 100%;' });

    predWrapper.appendChild(predBtn);
    predWrapper.appendChild(predMenu);
    dependencyGroup.appendChild(predWrapper);
    form.appendChild(dependencyGroup);

    predBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.multi-select-menu.show').forEach(m => {
        if (m !== predMenu) m.classList.remove('show');
      });
      predMenu.classList.toggle('show');
    });

    predMenu.addEventListener('click', (e) => e.stopPropagation());

    const existingTasks = WorkflowData.getTasksWhere(t => t.workRequestId === wrId);
    let selectedPreds = [];

    const updateModalSelectionText = () => {
      // Auto-check All Tasks (*) if all individual tasks are checked
      const allCheckbox = predMenu.querySelector('.multi-select-option input[value="*"]');
      const individualCheckboxes = Array.from(predMenu.querySelectorAll('.multi-select-option input')).filter(input => input.value !== '*');
      if (allCheckbox && !allCheckbox.checked && individualCheckboxes.length > 0 && individualCheckboxes.every(cb => cb.checked)) {
        allCheckbox.checked = true;
        if (!selectedPreds.includes('*')) {
          selectedPreds = ['*'];
        }
      }

      if (selectedPreds.includes('*')) {
        predBtn.textContent = 'All Tasks (*)';
        predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
          if (input.value !== '*') input.checked = true;
        });
      } else if (selectedPreds.length > 0) {
        const selectedLabels = selectedPreds.map(id => {
          const t = existingTasks.find(x => x.id === id);
          return t ? (t.title || 'Untitled task') : 'Task';
        });
        predBtn.textContent = selectedLabels.join(', ');
      } else {
        predBtn.textContent = '— No dependency —';
      }
    };

    if (existingTasks.length > 0) {
      const optionEl = el('label', { class: 'multi-select-option' });
      const checkbox = el('input', { type: 'checkbox', value: '*' });
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
            if (input !== checkbox) input.checked = true;
          });
          selectedPreds = ['*'];
        } else {
          predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
            input.checked = false;
          });
          selectedPreds = [];
        }
        updateModalSelectionText();
      });
      optionEl.appendChild(checkbox);
      optionEl.appendChild(document.createTextNode('All Tasks (*)'));
      predMenu.appendChild(optionEl);
    }

    existingTasks.forEach(t => {
      const optionEl = el('label', { class: 'multi-select-option' });
      const checkbox = el('input', { type: 'checkbox', value: t.id });
      checkbox.addEventListener('change', () => {
        if (!checkbox.checked) {
          const allCheckbox = predMenu.querySelector('.multi-select-option input[value="*"]');
          if (allCheckbox) allCheckbox.checked = false;
          if (selectedPreds.includes('*')) {
            selectedPreds = existingTasks.map(x => x.id);
          }
          selectedPreds = selectedPreds.filter(id => id !== t.id);
        } else {
          if (selectedPreds.includes('*')) {
            selectedPreds = existingTasks.map(x => x.id);
            const allCheckbox = predMenu.querySelector('.multi-select-option input[value="*"]');
            if (allCheckbox) allCheckbox.checked = false;
          }
          if (!selectedPreds.includes(t.id)) {
            selectedPreds.push(t.id);
          }
        }
        updateModalSelectionText();
      });
      optionEl.appendChild(checkbox);
      optionEl.appendChild(document.createTextNode(t.title || 'Untitled task'));
      predMenu.appendChild(optionEl);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateRequiredFields(form)) return;
      const groundWorkerName = gwDropdown.searchText.trim();
      const data = Object.fromEntries(new FormData(form).entries());
      const allExistingIds = existingTasks.map(t => t.id);
      const predecessors = selectedPreds.includes('*') ? allExistingIds : selectedPreds;

      const res = await this.resolveAssignee(groundWorkerName);

      const newTask = {
        id: generateId('t'),
        workRequestId: wrId,
        title: data.title.trim(),
        assigneeId: res.id,
        assigneeName: res.name,
        coAssignees: isDraft ? coAssignees.filter(Boolean) : [],
        status: (groundWorkerName || coAssignees.length > 0) ? 'Assigned' : 'Draft',
        priority: data.priority || 'Priority',
        dueDate: data.dueDate || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        predecessors,
        checklist: checklistItems.map(item => ({
          id: item.id || generateUUID(),
          text: item.text,
          category: item.category || 'subtask',
          completed: false,
          assigneeId: item.assigneeId || null,
          assigneeName: item.assigneeName || null,
          dependsOn: item.dependsOn || null,
          timeLogs: []
        })),
        timeLogs: [],
        taskDocuments: [],
        comments: []
      };
      const result = await PendingChanges.submit('tasks', newTask, true);
      if (result.approved) {
        const runResult = await this.runBlockingArchiveAction({
          title: 'Adding Task',
          message: `Please wait while "${newTask.title || 'the task'}" is being added...`,
          apiCall: async () => {
            // Optimistic insert so counts update immediately under the overlay.
            WorkflowData._addOptimisticTask(newTask);
            try {
              if (result.record) {
                const serverTask = WorkflowData.normalizeTask(result.record);
                serverTask.workRequestId = newTask.workRequestId;
                this._syncTaskToCaches(serverTask);
                return { data: serverTask };
              }
              const created = await WorkflowData.createTask(newTask);
              this._syncTaskToCaches(created);
              return { data: created };
            } catch (e) {
              console.error('Failed to add task', e);
              WorkflowData._removeTask(newTask.id);
              throw e;
            }
          },
          successTitle: 'Task Added',
          successMessage: 'Task has been added to the work request.',
          errorTitle: 'Failed to Add Task'
        });
        if (runResult.success) {
          if (typeof Dashboard !== 'undefined' && Dashboard.invalidateCache) Dashboard.invalidateCache();
          this._invalidateCountsAndSidebar();
          closeFormPanelAndRoute('#operations/detail/' + wrId);
        } else {
          App.handleRoute();
        }
      } else {
        this.showMessage('Task Added', 'Task addition has been submitted for Manager approval.', 'success');
        closeFormPanelAndRoute('#operations/detail/' + wrId);
      }
    });

    return form;
  },

  async showAddTaskPanel(wrId, mode = null) {
    const form = await this.renderAddTaskForm(wrId, { hideHeader: mode !== PaneMode.SIDE_PEEK && mode !== null });
    if (!form) return;
    const fullPageRoute = '#operations/addTask/' + wrId;
    openFormPanel({
      icon: '✅',
      title: null,
      formContent: form,
      formId: 'add-task-form',
      mode,
      viewContext: 'add-task-form',
      fullPageRoute,
      newTabRoute: fullPageRoute,
      actions: [
        { text: 'Add Task', class: 'btn btn-primary', type: 'submit', form: 'add-task-form' },
        { text: 'Cancel', class: 'btn btn-secondary', onClick: () => closeFormPanelAndRoute('#operations/detail/' + wrId) }
      ]
    });
  },

  /**
   * Opens the Work Request form in a shared side-peek panel, optionally forcing a
   * specific pane mode. Used by the full-page view switcher.
   */
  async openWorkRequestForm(mode = null) {
    const isNew = !this.editingId;
    const wr = isNew ? null : WorkflowData.getWorkRequestById(this.editingId);
    const fullPageRoute = isNew ? '#operations/form/new' : `#operations/form/${this.editingId}`;
    const formEl = await this.renderForm();
    openFormPanel({
      icon: '📝',
      title: ' ',
      formContent: formEl,
      formId: 'wr-form',
      mode,
      viewContext: 'work-request-form',
      fullPageRoute,
      newTabRoute: fullPageRoute,
      actions: [
        { text: isNew ? 'Submit Request' : 'Save Changes', class: 'btn btn-primary', type: 'submit', form: 'wr-form' },
        { text: 'Cancel', class: 'btn btn-secondary', onClick: () => closeFormPanelAndRoute('#operations') }
      ]
    });
  },

  /**
   * Opens the Retainer Template form in a shared side-peek panel, optionally forcing
   * a specific pane mode. Used by the full-page view switcher.
   */
  async openRetainerTemplateForm(mode = null) {
    const isNew = !this.templateEditingId;
    const template = isNew ? null : this._getRetainerTemplateById(this.templateEditingId);
    const fullPageRoute = isNew ? '#operations/templateForm/new' : `#operations/templateForm/${this.templateEditingId}`;
    openFormPanel({
      icon: '📋',
      title: ' ',
      formContent: await this.renderTemplateForm({ hideHeader: mode !== PaneMode.SIDE_PEEK && mode !== null }),
      formId: 'template-form',
      mode,
      viewContext: 'retainer-template-form',
      fullPageRoute,
      newTabRoute: fullPageRoute,
      actions: [
        { text: 'Save Template', class: 'btn btn-primary', type: 'submit', form: 'template-form' },
        { text: 'Cancel', class: 'btn btn-secondary', onClick: () => closeFormPanelAndRoute('#operations') }
      ]
    });
  },

  async showEditTaskModal(taskId, onSaved) {
    const task = WorkflowData.getTaskById(taskId);
    if (!task) return;
    const wr = WorkflowData.getWorkRequestById(task.workRequestId);
    const isDraft = wr?.status === 'Draft';

    const form = el('form', { class: 'form-stacked' });

    // Task Title
    const titleInput = el('input', { type: 'text', name: 'title', required: true, value: task.title || '' });
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Task Title *' }),
      titleInput
    ]));

    // Assignee Group
    const assigneeGroup = el('div', { class: 'form-group' });
    assigneeGroup.appendChild(el('label', { text: 'Assignee' }));
    const gwDropdown = await this.createGroundWorkerDropdown({
      placeholder: 'Employee...',
      className: 'modal-task-assignee',
      selectedGroundWorkerName: task.assigneeName || '',
      onChange: () => {}
    });
    const assigneeWrapper = el('div', { class: 'task-assignee-wrapper' });
    assigneeWrapper.appendChild(gwDropdown);
    assigneeGroup.appendChild(assigneeWrapper);
    form.appendChild(assigneeGroup);

    // Co-assignees
    let coAssignees = [...(task.coAssignees || [])];
    const coAssigneeGroup = el('div', { class: 'form-group' });
    coAssigneeGroup.appendChild(el('label', { text: 'Co-assignees' }));
    const coAssigneeChips = el('div', { class: 'co-assignee-chips' });
    const coAssigneeDropdown = await this.createGroundWorkerDropdown({
      placeholder: 'Add co-assignee...',
      className: 'modal-co-assignee',
      onChange: ({ assigneeName }) => {
        const name = assigneeName?.trim();
        if (!name) return;
        const primaryName = (gwDropdown.searchText || '').trim();
        if (name === primaryName) {
          coAssigneeDropdown.value = '';
          return;
        }
        if (!coAssignees.includes(name)) {
          coAssignees.push(name);
          const isUser = ((window.apiClient.userCache._users || []) || []).some(u => u.name.toLowerCase() === name.toLowerCase());
          if (!isUser) {
            this._addGroundWorker(name);
          }
          renderCoAssigneeChips();
        }
        coAssigneeDropdown.value = '';
      }
    });

    const renderCoAssigneeChips = () => {
      coAssigneeChips.innerHTML = '';
      coAssignees.forEach((name, idx) => {
        const chip = el('span', { class: 'co-assignee-chip', text: name });
        const remove = el('span', { class: 'co-assignee-chip-remove', text: '×' });
        remove.addEventListener('click', () => {
          coAssignees.splice(idx, 1);
          renderCoAssigneeChips();
        });
        chip.appendChild(remove);
        coAssigneeChips.appendChild(chip);
      });
    };
    renderCoAssigneeChips();
    coAssigneeGroup.appendChild(coAssigneeChips);
    coAssigneeGroup.appendChild(coAssigneeDropdown);
    if (isDraft) {
      form.appendChild(coAssigneeGroup);
    }

    // Initialize from existing task checklist or empty array
    let checklistItems = Array.isArray(task.checklist) ? [...task.checklist] : [];

    // Append the Checklist Builder layout (identical to Add Task modal)
    const checklistGroup = el('div', { class: 'form-group' });
    checklistGroup.appendChild(el('label', { text: 'Checklist Items' }));
    const checklistContainer = el('div', { class: 'checklist-items-container' });

    const checklistBuilder = el('div', { style: 'display:flex; gap:8px; align-items:center;' });
    const checklistInput = el('input', { type: 'text', placeholder: 'Add a checklist item...', style: 'flex:1;' });
    const checklistCategorySel = el('select', { style: 'width:110px; flex-shrink:0;' });
    checklistCategorySel.appendChild(el('option', { value: 'subtask', text: 'Sub-task' }));
    checklistCategorySel.appendChild(el('option', { value: 'document', text: 'Document' }));
    const addChecklistBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Add' });
    checklistBuilder.appendChild(checklistInput);
    checklistBuilder.appendChild(checklistCategorySel);
    checklistBuilder.appendChild(addChecklistBtn);
    checklistContainer.appendChild(checklistBuilder);
    checklistGroup.appendChild(checklistContainer);
    form.appendChild(checklistGroup);

    const renderChecklist = async () => {
      const existingList = checklistContainer.querySelector('.checklist-items-list');
      if (existingList) existingList.remove();
      if (checklistItems.length === 0) return;

      const list = el('div', { class: 'checklist-items-list', style: 'display:flex; flex-direction:column; gap:6px; margin-top:8px;' });
      for (const [idx, item] of checklistItems.entries()) {
        const row = el('div', { style: 'display:flex; align-items:center; gap:8px; padding:6px 8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius: 12px;' });
        row.appendChild(el('span', { text: item.text, style: 'flex:1; font-size:0.85rem;' }));
        const categoryBadge = el('span', {
          text: item.category === 'document' ? 'Document' : 'Sub-task',
          style: 'font-size:0.7rem; padding:2px 6px; border-radius: 12px; background:' + (item.category === 'document' ? '#dbeafe' : '#f3f4f6') + '; color:' + (item.category === 'document' ? '#1e40af' : '#4b5563') + '; font-weight:600;'
        });
        row.appendChild(categoryBadge);

        const prereqSelect = el('select', { style: 'font-size:0.8rem; max-width:140px;' });
        prereqSelect.appendChild(el('option', { value: '', text: '— None —' }));
        prereqSelect.appendChild(el('option', { value: '*', text: 'All Task (*)' }));
        checklistItems.slice(0, idx).forEach((prev, pIdx) => {
          if (!prev.id) prev.id = generateUUID();
          prereqSelect.appendChild(el('option', { value: prev.id, text: `${pIdx + 1}. ${prev.text}` }));
        });
        if (checklistItems.length <= 1) {
          prereqSelect.disabled = true;
        }
        prereqSelect.value = item.dependsOn || '';
        prereqSelect.addEventListener('change', () => {
          item.dependsOn = prereqSelect.value || null;
        });
        row.appendChild(prereqSelect);

        const assigneeDropdown = await this.createGroundWorkerDropdown({
          selectedGroundWorkerName: item.assigneeName,
          placeholder: 'Assign...',
          maxWidth: '140px',
          className: 'modal-checklist-assignee',
          onChange: ({ assigneeId, assigneeName }) => {
            item.assigneeId = assigneeId || null;
            item.assigneeName = assigneeName || null;
          }
        });
        row.appendChild(assigneeDropdown);

        const delBtn = el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: '×' });
        delBtn.addEventListener('click', async () => {
          checklistItems.splice(idx, 1);
          await renderChecklist();
        });
        row.appendChild(delBtn);
        list.appendChild(row);
      }
      checklistContainer.insertBefore(list, checklistBuilder);
    };

    const addChecklistItem = async () => {
      const val = checklistInput.value.trim();
      if (!val) return;
      checklistItems.push({ id: generateUUID(), text: val, category: checklistCategorySel.value || 'subtask', assigneeId: null, assigneeName: null, dependsOn: null, timeLogs: [] });
      checklistInput.value = '';
      await renderChecklist();
    };
    addChecklistBtn.addEventListener('click', addChecklistItem);
    checklistInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addChecklistItem();
      }
    });

    await renderChecklist();

    // Due Date
    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Due Date' }),
      el('input', { type: 'date', name: 'dueDate', value: task.dueDate || '' })
    ]));

    // Priority
    const priorityGroup = el('div', { class: 'form-group' });
    priorityGroup.appendChild(el('label', { text: 'Priority' }));
    const prioritySel = el('select', { name: 'priority' });
    ['Priority', 'Low Priority', 'Urgent'].forEach(p => {
      const opt = el('option', { value: p, text: p });
      if (p === task.priority) opt.selected = true;
      prioritySel.appendChild(opt);
    });
    if (task.priority && !['Priority', 'Low Priority', 'Urgent'].includes(task.priority)) {
      const fallbackOpt = el('option', { value: task.priority, text: task.priority, selected: true });
      prioritySel.insertBefore(fallbackOpt, prioritySel.firstChild);
    }
    priorityGroup.appendChild(prioritySel);
    form.appendChild(priorityGroup);

    // Dependencies selector
    const dependencyGroup = el('div', { class: 'form-group' });
    dependencyGroup.appendChild(el('label', { text: 'Dependency' }));

    const predWrapper = el('div', { class: 'multi-select-dropdown', style: 'width: 100%;' });
    const predBtn = el('button', { type: 'button', class: 'multi-select-btn', text: '— No dependency —', style: 'width: 100%;' });
    const predMenu = el('div', { class: 'multi-select-menu', style: 'width: 100%;' });
    predWrapper.appendChild(predBtn);
    predWrapper.appendChild(predMenu);
    dependencyGroup.appendChild(predWrapper);
    form.appendChild(dependencyGroup);

    predBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.multi-select-menu.show').forEach(m => {
        if (m !== predMenu) m.classList.remove('show');
      });
      predMenu.classList.toggle('show');
    });
    predMenu.addEventListener('click', (e) => e.stopPropagation());

    const existingTasks = WorkflowData.getTasksWhere(t => t.workRequestId === task.workRequestId && t.id !== task.id);
    let selectedPreds = [...(task.predecessors || [])];

    const updateModalSelectionText = () => {
      // Auto-check All Tasks (*) if all individual tasks are checked
      const allCheckbox = predMenu.querySelector('.multi-select-option input[value="*"]');
      const individualCheckboxes = Array.from(predMenu.querySelectorAll('.multi-select-option input')).filter(input => input.value !== '*');
      if (allCheckbox && !allCheckbox.checked && individualCheckboxes.length > 0 && individualCheckboxes.every(cb => cb.checked)) {
        allCheckbox.checked = true;
        if (!selectedPreds.includes('*')) {
          selectedPreds = ['*'];
        }
      }

      if (selectedPreds.includes('*')) {
        predBtn.textContent = 'All Tasks (*)';
        predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
          if (input.value !== '*') input.checked = true;
        });
      } else if (selectedPreds.length > 0) {
        const selectedLabels = selectedPreds.map(id => {
          const t = existingTasks.find(x => x.id === id);
          return t ? (t.title || 'Untitled task') : 'Task';
        });
        predBtn.textContent = selectedLabels.join(', ');
      } else {
        predBtn.textContent = '— No dependency —';
      }
    };

    if (existingTasks.length > 0) {
      const optionEl = el('label', { class: 'multi-select-option' });
      const checkbox = el('input', { type: 'checkbox', value: '*' });
      if (selectedPreds.includes('*')) checkbox.checked = true;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
            if (input !== checkbox) input.checked = true;
          });
          selectedPreds = ['*'];
        } else {
          predMenu.querySelectorAll('.multi-select-option input').forEach(input => {
            input.checked = false;
          });
          selectedPreds = [];
        }
        updateModalSelectionText();
      });
      optionEl.appendChild(checkbox);
      optionEl.appendChild(document.createTextNode('All Tasks (*)'));
      predMenu.appendChild(optionEl);
    }

    existingTasks.forEach(t => {
      const optionEl = el('label', { class: 'multi-select-option' });
      const checkbox = el('input', { type: 'checkbox', value: t.id });
      if (selectedPreds.includes(t.id) || selectedPreds.includes('*')) checkbox.checked = true;
      checkbox.addEventListener('change', () => {
        if (!checkbox.checked) {
          const allCheckbox = predMenu.querySelector('.multi-select-option input[value="*"]');
          if (allCheckbox) allCheckbox.checked = false;
          if (selectedPreds.includes('*')) {
            selectedPreds = existingTasks.map(x => x.id);
          }
          selectedPreds = selectedPreds.filter(id => id !== t.id);
        } else {
          if (selectedPreds.includes('*')) {
            selectedPreds = existingTasks.map(x => x.id);
            const allCheckbox = predMenu.querySelector('.multi-select-option input[value="*"]');
            if (allCheckbox) allCheckbox.checked = false;
          }
          if (!selectedPreds.includes(t.id)) {
            selectedPreds.push(t.id);
          }
        }
        updateModalSelectionText();
      });
      optionEl.appendChild(checkbox);
      optionEl.appendChild(document.createTextNode(t.title || 'Untitled task'));
      predMenu.appendChild(optionEl);
    });
    updateModalSelectionText();

    const isResubmitting = typeof PendingChanges !== 'undefined' && PendingChanges.editingPendingId;
    const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: isResubmitting ? 'Save & Resubmit' : 'Save Changes' });
    form.appendChild(submitBtn);

    const overlay = this.showModal('Edit Task', form, () => {
      if (typeof PendingChanges !== 'undefined') {
        PendingChanges.editingPendingId = null;
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateRequiredFields(form)) return;
      const groundWorkerName = gwDropdown.searchText.trim();
      const data = Object.fromEntries(new FormData(form).entries());
      const allExistingIds = existingTasks.map(t => t.id);
      const predecessors = selectedPreds.includes('*') ? allExistingIds : selectedPreds;

      const res = await this.resolveAssignee(groundWorkerName);

      const runResult = await this.runBlockingArchiveAction({
        title: 'Saving Task',
        message: `Please wait while "${task.title || 'the task'}" is being updated...`,
        apiCall: async () => {
          await WorkflowData.updateTask(task.id, {
            title: data.title.trim(),
            assigneeId: res.id,
            assigneeName: res.name,
            coAssignees: isDraft ? coAssignees.filter(Boolean) : task.coAssignees || [],
            priority: data.priority || 'Priority',
            dueDate: data.dueDate || '',
            predecessors: predecessors,
            checklist: checklistItems,
            updatedAt: new Date().toISOString()
          });
          const updated = WorkflowData.getTaskById(task.id);
          this._syncTaskToCaches(updated);
          return { data: updated };
        },
        successTitle: 'Task Saved',
        successMessage: 'Task has been successfully updated.',
        errorTitle: 'Failed to Save Task'
      });

      if (runResult.success) {
        this._invalidateCountsAndSidebar();
      }
      overlay.remove();
      if (onSaved) onSaved();
    });
  },

  renderModernProgressBar(status) {
    // Four-stage lifecycle inside work request detail (Billing/Disbursement are no longer phases).
    const stages = ['Work Request', 'Pre-processing', 'Processing', 'Documentation'];
    const map = { 'Draft': 0, 'Pre-processing': 1, 'Processing': 2, 'Billing': 2, 'Disbursement': 2, 'Completed': 3, 'Cancelled': 3 };
    const currentIdx = map[status] ?? 0;

    const tracker = el('div', { class: 'stage-tracker', 'aria-label': 'Work request stage' });

    stages.forEach((stageName, i) => {
      let stageClass = 'stage';
      if (i < currentIdx) {
        stageClass = 'stage completed';
      } else if (i === currentIdx) {
        stageClass = 'stage active';
      }

      const stageEl = el('div', { class: stageClass });

      const dotEl = i < currentIdx
        ? el('div', { class: 'stage-dot', html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` })
        : el('div', { class: 'stage-dot', text: String(i + 1) });

      const labelEl = el('span', { class: 'stage-label', text: stageName });

      stageEl.appendChild(dotEl);
      stageEl.appendChild(labelEl);
      tracker.appendChild(stageEl);

      if (i < stages.length - 1) {
        let connClass = 'stage-connector';
        if (i < currentIdx) {
          connClass = 'stage-connector completed';
        }
        const connectorEl = el('div', { class: connClass });
        tracker.appendChild(connectorEl);
      }
    });

    return tracker;
  },

  renderTaskActivity(tasks) {
    const task = tasks.find(t => t.id === this.selectedTaskId) || tasks[0];
    const section = el('div', { class: 'form-section' });
    section.appendChild(el('h3', { text: 'Task Activity' }));

    const selectorGroup = el('div', { class: 'form-group' });
    selectorGroup.appendChild(el('label', { text: 'Select Task' }));
    const selector = el('select', { class: 'form-select' });
    tasks.forEach(t => {
      const opt = el('option', { value: t.id, text: t.title });
      if (t.id === task.id) opt.selected = true;
      selector.appendChild(opt);
    });
    selector.addEventListener('change', () => {
      this.selectedTaskId = selector.value;
      App.handleRoute();
    });
    selectorGroup.appendChild(selector);
    section.appendChild(selectorGroup);

    // Time Log
    section.appendChild(el('h4', { text: 'Time Log' }));
    const logs = task.timeLogs || [];
    if (logs.length === 0) {
      section.appendChild(renderEmptyState('No time logs recorded yet'));
    } else {
      const logTable = el('table', { class: 'data-table' });
      logTable.appendChild(el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Date' }),
          el('th', { text: 'Start' }),
          el('th', { text: 'End' }),
          el('th', { text: 'Hours' }),
          el('th', { text: 'User' }),
          el('th', { text: 'Note' })
        ])
      ]));
      const logBody = el('tbody');
      logs.forEach(l => {
        const user = window.apiClient.userCache.getById(l.userId);
        logBody.appendChild(el('tr', {}, [
          el('td', { text: formatDate(l.date) }),
          el('td', { text: l.startTime || '—' }),
          el('td', { text: l.endTime || '—' }),
          el('td', { text: String(l.hours) }),
          el('td', { text: user?.name || l.userId }),
          el('td', { text: l.note || '—' })
        ]));
      });
      logTable.appendChild(logBody);
      section.appendChild(logTable);
    }

    // Task Activity section keeps read-only history only;
    // add forms have been moved to modals inside each task accordion panel.

    // Comments
    section.appendChild(el('h4', { text: 'Comments' }));
    const comments = task.comments || [];
    if (comments.length === 0) {
      section.appendChild(renderEmptyState('No comments yet'));
    } else {
      const commentList = el('div');
      comments.forEach(c => {
        const user = window.apiClient.userCache.getById(c.userId);
        commentList.appendChild(el('div', { class: 'card', style: 'margin-bottom: var(--spacing-sm);' }, [
          el('div', { class: 'kpi-label', text: (user?.name || c.userId) + ' • ' + formatDate(c.date) }),
          el('div', { text: c.comment })
        ]));
      });
      section.appendChild(commentList);
    }

    const commentForm = el('form', { class: 'form-stacked' });
    commentForm.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Add Comment *' }),
      el('textarea', { name: 'commentText', rows: 3, required: true })
    ]));
    const commentBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Post Comment' });
    commentForm.appendChild(commentBtn);
    commentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(commentForm);
      const entry = {
        userId: Auth.user.id,
        date: new Date().toISOString(),
        comment: fd.get('commentText').trim()
      };
      if (!entry.comment) return;
      const updatedComments = [...(task.comments || []), entry];
      WorkflowData.updateTask(task.id, { comments: updatedComments, updatedAt: new Date().toISOString() });
      App.handleRoute();
    });
    section.appendChild(commentForm);

    return section;
  },

  getValidNextStatuses(task) {
    const flow = ['Draft', 'Assigned', 'In Progress', 'For Review', 'Completed'];
    if (task.status === 'Completed' || task.status === 'Cancelled') {
      return [task.status];
    }
    const idx = Math.max(flow.indexOf(task.status), 0);
    const allowed = new Set(flow.slice(0, idx + 2));
    allowed.add('Cancelled');

    // Retrieve associated Work Request, if any
    const wr = task.workRequestId ? WorkflowData.getWorkRequestById(task.workRequestId) : null;
    let result;
    if (wr) {
      if (wr.status === 'Completed' || wr.status === 'Cancelled') {
        return [task.status];
      }
      let capStatus = null;
      if (wr.status === 'Draft') {
        capStatus = 'Assigned';
      } else if (wr.status === 'Pre-processing') {
        capStatus = 'Completed';
      } else if (wr.status === 'Processing') {
        capStatus = 'Completed';
      } else if (wr.status === 'Billing' || wr.status === 'Disbursement') {
        capStatus = task.status;
      }

      if (capStatus) {
        const capIdx = flow.indexOf(capStatus);
        if (capIdx !== -1) {
          const capFlow = flow.slice(0, capIdx + 1);
          const filtered = new Set();
          allowed.forEach(status => {
            if (capFlow.includes(status) || status === 'Cancelled') {
              filtered.add(status);
            }
          });
          result = Array.from(filtered);
        }
      }
    }

    if (!result) result = Array.from(allowed);

    // Block terminal statuses if checklist has incomplete items
    const checklist = task.checklist || [];
    const hasIncomplete = checklist.some(item => !item.completed);
    if (hasIncomplete) {
      result = result.filter(s => s !== 'Completed' && s !== 'For Review');
    }

    return result;
  },

  // ============================================================
  // Dependency Engine
  // ============================================================
  canStart(taskId) {
    const task = WorkflowData.getTaskById(taskId);
    const preds = task?.predecessors || task?.dependencies || [];
    if (preds.length === 0) return true;
    return preds.every(pid => {
      const p = WorkflowData.getTaskById(pid);
      return p && p.status === 'Completed';
    });
  },

  updateTaskStatus(taskId, newStatus) {
    const task = WorkflowData.getTaskById(taskId);
    if (!task) return { error: 'Task not found.' };
    if (task.status === 'Completed' || task.status === 'Cancelled') {
      return { error: 'Completed and cancelled tasks are immutable.' };
    }
    const allowed = this.getValidNextStatuses(task);
    if (!allowed.includes(newStatus)) {
      const wr = task.workRequestId ? WorkflowData.getWorkRequestById(task.workRequestId) : null;
      if (wr) {
        return { error: `Task status cannot be set to "${newStatus}" in the "${wr.status}" phase.` };
      }
      return { error: `Task status cannot be set to "${newStatus}".` };
    }
    if ((newStatus === 'In Progress' || newStatus === 'Completed') && !this.canStart(taskId)) {
      return { error: 'Dependency tasks must be completed first.' };
    }
    if (newStatus === 'Assigned' && !(task.assigneeId || task.assignedTo || task.assigneeName)) {
      return { error: 'A task cannot be marked Assigned without an assignee.' };
    }

    if (newStatus === 'Completed' || newStatus === 'For Review') {
      const checklist = task.checklist || [];
      const hasIncomplete = checklist.some(item => !item.completed);
      if (hasIncomplete) {
        return { error: `All checklist items must be completed before marking this task as ${newStatus}.` };
      }
    }

    const now = new Date().toISOString();
    const cascaded = [];

    if (newStatus === 'Cancelled') {
      // Recursively cancel all downstream dependents (full dependency chain)
      const toCancel = new Set();
      const queue = [taskId];
      const visited = new Set();

      while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const dependents = WorkflowData.getTasksWhere(t =>
          (t.predecessors || t.dependencies || []).includes(currentId)
        );

        dependents.forEach(d => {
          if (d.status !== 'Completed' && d.status !== 'Cancelled' && d.id !== taskId) {
            toCancel.add(d.id);
          }
          if (!visited.has(d.id)) {
            queue.push(d.id);
          }
        });
      }

      toCancel.forEach(id => {
        WorkflowData.updateTask(id, { status: 'Cancelled', updatedAt: now });
        cascaded.push(id);
      });
    }

    WorkflowData.updateTask(taskId, { status: newStatus, updatedAt: now });
    return { success: true, cascaded };
  },

  detectCycle(tasks) {
    const adj = {};
    tasks.forEach(t => { adj[t.id] = t.predecessors || t.dependencies || []; });
    const visited = new Set();
    const recStack = new Set();
    function dfs(node) {
      visited.add(node);
      recStack.add(node);
      for (const neighbor of adj[node] || []) {
        if (!visited.has(neighbor) && dfs(neighbor)) return true;
        if (recStack.has(neighbor)) return true;
      }
      recStack.delete(node);
      return false;
    }
    for (const node of Object.keys(adj)) {
      if (!visited.has(node) && dfs(node)) return true;
    }
    return false;
  },

  // ============================================================
  // Retainer Templates
  // ============================================================
  async renderTemplates() {
    if (!Auth.can('workflow:approve')) {
      this.view = 'list';
      App.handleRoute();
      return el('div');
    }

    await Promise.all([this.ensureRetainerTemplates(), window.apiClient.clientCache.ensure()]);
    const entity = Auth.activeEntity;
    const templates = (this._retainerTemplates || []).filter(t => this._entityMatchesRetainerTemplate(t, entity));

    const wrapper = el('div', { class: 'page-content-section' });

    const backlogItems = templates.map(t => {
      const client = window.apiClient.clientCache.getById(t.clientId);
      return {
        id: t.id,
        name: t.name,
        iconHtml: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--color-primary);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        tags: [
          { text: client?.name || 'No Client', type: 'client' },
          { text: t.schedule || '—', type: 'schedule', value: t.schedule, style: 'text-transform: capitalize;' },
          { text: formatPHP(t.pfAmount || 0), type: 'amount' },
          { text: String((t.tasks || []).length), type: 'points', title: 'Tasks count' }
        ]
      };
    });

    const backlog = JiraBacklogList.render({
      title: 'Retainer Templates',
      subtitle: 'recurring client service agreements, task schedules, and professional fee presets',
      items: backlogItems,
      emptyText: 'No retainer templates found',
      rowIdPrefix: 'RT',
      bulkActions: (selectedIds) => [
        {
          text: selectedIds.length === 1 ? 'Generate' : 'Bulk Generate',
          className: 'btn btn-primary btn-sm',
          onClick: (ids) => {
            const title = ids.length === 1 ? 'Generate Work Request' : 'Bulk Generate Work Requests';
            const message = ids.length === 1
              ? 'Are you sure you want to generate a Work Request for this selected retainer template?'
              : `Are you sure you want to generate Work Requests for these ${ids.length} selected retainer templates?`;
            this.showConfirm(
              title,
              message,
              () => {
                this.bulkGenerateFromTemplates(ids);
              }
            );
          }
        },
        {
          text: 'Delete',
          className: 'btn btn-danger btn-sm',
          onClick: (ids) => {
            const title = ids.length === 1 ? 'Delete Template' : 'Delete Templates';
            const message = ids.length === 1
              ? 'Are you sure you want to delete this template?'
              : `Are you sure you want to delete these ${ids.length} templates?`;
            this.showConfirm(
              title,
              message,
              async () => {
                for (const id of ids) {
                  await this._deleteRetainerTemplate(id);
                }
                App.handleRoute();
              },
              'danger'
            );
          }
        }
      ],
      headerActions: [
        {
          text: '+ Create Template',
          className: 'btn btn-primary btn-sm',
          onClick: async () => {
            this.templateEditingId = null;
            await this.openRetainerTemplateForm();
          }
        }
      ],
      rowActions: (item) => [
        {
          text: 'Edit',
          className: 'btn btn-secondary btn-xs',
          onClick: async () => {
            this.templateEditingId = item.id;
            await this.openRetainerTemplateForm();
          }
        },
        {
          text: 'Delete',
          className: 'btn btn-danger btn-xs',
          onClick: () => {
            this.showConfirm('Delete Template', `Are you sure you want to delete "${item.name}"?`, async () => {
              await this._deleteRetainerTemplate(item.id);
              App.handleRoute();
            }, 'danger');
          }
        }
      ]
    });

    wrapper.appendChild(backlog);

    // Silently merge any new/updated server templates without overwriting
    // optimistic records.
    this.backgroundRefreshRetainerTemplates().catch(err => {
      if (!isAbortError(err)) console.warn('Retainer template background refresh failed', err);
    });

    return wrapper;
  },

  async renderTemplateForm(opts = {}) {
    if (!Auth.can('workflow:approve')) {
      this.view = 'list';
      App.handleRoute();
      return el('div');
    }

    const { hideHeader = false } = opts || {};
    const entity = Auth.activeEntity;
    const template = this.templateEditingId ? this._getRetainerTemplateById(this.templateEditingId) : null;
    const container = el('div', { class: 'page' });

    const form = el('form', { id: 'template-form', class: 'form-stacked notion-form' });

    if (!hideHeader) {
      const headerBar = el('div', { class: 'form-header-bar' });

      const topActions = el('div', { class: 'form-actions-top' });
      const saveBtn = el('button', { type: 'submit', form: 'template-form', class: 'btn btn-primary', text: 'Save Template' });
      topActions.appendChild(saveBtn);
      
      if (template) {
        const delBtn = el('button', { type: 'button', class: 'btn btn-danger', text: 'Delete', style: 'margin-left: 8px;' });
        delBtn.addEventListener('click', () => {
          this.showConfirm('Delete Template', 'Are you sure you want to delete this template?', () => {
            this._deleteRetainerTemplate(template.id);
            this.view = 'templates'; 
            this.templateEditingId = null; 
            closeFormPanelAndRoute('#operations');
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
      placeholder: 'New Work Request Template', required: true, value: template?.name || ''
    });
    titleSection.appendChild(nameInput);
    if (!template) {
      setTimeout(() => { nameInput.focus(); }, 60);
    }
    form.appendChild(titleSection);

    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Description' }),
      el('textarea', { name: 'description', rows: 3, text: template?.description || '' })
    ]));

    const clientGroup = el('div', { class: 'form-group' });
    clientGroup.appendChild(el('label', { text: 'Client *' }));
    const clientSel = el('select', { name: 'clientId', required: true });
    clientSel.appendChild(el('option', { value: '', text: '— Select Client —' }));
    (window.apiClient.clientCache._clients || []).filter(c => matchesEntity(c.entity, entity)).forEach(c => {
      const opt = el('option', { value: c.id, text: c.name });
      if (template && template.clientId === c.id) opt.selected = true;
      clientSel.appendChild(opt);
    });
    clientGroup.appendChild(clientSel);
    form.appendChild(clientGroup);

    const scheduleGroup = el('div', { class: 'form-group' });
    scheduleGroup.appendChild(el('label', { text: 'Schedule *' }));
    const scheduleSel = el('select', { name: 'schedule', required: true });
    ['monthly', 'quarterly'].forEach(s => {
      const opt = el('option', { value: s, text: s });
      if (template && template.schedule === s) opt.selected = true;
      scheduleSel.appendChild(opt);
    });
    scheduleGroup.appendChild(scheduleSel);
    form.appendChild(scheduleGroup);

    form.appendChild(el('div', { class: 'form-group' }, [
      el('label', { text: 'Professional Fee (₱) *' }),
      el('input', { type: 'number', name: 'pfAmount', min: 0, step: 0.01, required: true, value: template?.pfAmount || '' })
    ]));

    // Template Tasks section — heading outside the line-item container for visual grouping.
    form.appendChild(el('h3', { class: 'notion-section-heading', text: 'Template Tasks' }));
    const tasksSection = el('div', { class: 'notion-line-items' });
    const tasksList = el('div', { id: 'template-task-rows' });
    tasksSection.appendChild(tasksList);

    const addTaskBtn = el('button', { type: 'button', class: 'notion-add-line-item', text: '+ Add Task' });
    addTaskBtn.addEventListener('click', async () => {
      await this.addTaskRow(tasksList);
      this.updatePredecessorOptions(tasksList);
    });
    tasksSection.appendChild(addTaskBtn);

    form.appendChild(tasksSection);

    if (template && template.tasks) {
      for (const t of template.tasks) await this.addTaskRow(tasksList, t);
    } else {
      await this.addTaskRow(tasksList);
    }
    this.updatePredecessorOptions(tasksList);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.validateManualAssignees(form)) return;
      this.submitTemplateForm(form, tasksList);
    });

    container.appendChild(form);
    return container;
  },

  async submitTemplateForm(form, tasksList) {
    const data = Object.fromEntries(new FormData(form).entries());
    const now = new Date().toISOString();

    const taskRows = tasksList.querySelectorAll('.task-row');
    const tasks = [];
    taskRows.forEach(row => {
      const title = row.querySelector('.task-title-input').value.trim();
      if (!title) return;
      const gwAutocomplete = row.querySelector('.task-assignee-groundworker');
      const groundWorkerName = gwAutocomplete?.searchText?.trim() || '';

      // Auto-register new ground workers
      if (groundWorkerName) {
        this._addGroundWorker(groundWorkerName);
      }

      const predKeysStr = row.dataset.predKeys || '';
      const predecessorKeys = predKeysStr.split(',').filter(Boolean);
      tasks.push({
        key: row.dataset.taskKey || generateId('tmp'),
        title,
        assigneeId: null,
        assigneeName: groundWorkerName || null,
        coAssignees: row._coAssignees || [],
        predecessorKeys: predecessorKeys
      });
    });

    const cycleCheck = tasks.map((t, i) => {
      let preds = [];
      if (t.predecessorKeys.includes('*')) {
        preds = tasks.slice(0, i).map(pt => pt.key);
      } else {
        preds = t.predecessorKeys;
      }
      return { id: t.key, predecessors: preds };
    });
    if (this.detectCycle(cycleCheck)) {
      this.showMessage('Dependency Error', 'Template tasks contain a cycle. Please fix before saving.', 'danger');
      return;
    }

    const idMap = new Map();
    tasks.forEach(t => idMap.set(t.key, generateId('rtt')));

    const resolvePredecessors = (t, i) => {
      if (t.predecessorKeys.includes('*')) {
        return tasks.slice(0, i).map(pt => idMap.get(pt.key)).filter(Boolean);
      }
      return t.predecessorKeys.map(k => idMap.get(k)).filter(Boolean);
    };

    const taskRecords = tasks.map((t, i) => ({
      id: idMap.get(t.key),
      title: t.title,
      assigneeId: t.assigneeId || null,
      assigneeName: t.assigneeName || null,
      coAssignees: t.coAssignees || [],
      predecessors: resolvePredecessors(t, i)
    }));

    const record = {
      id: this.templateEditingId || generateId('rt'),
      name: data.name.trim(),
      description: data.description?.trim() || '',
      clientId: data.clientId,
      entity: Auth.activeEntity,
      schedule: data.schedule,
      pfAmount: parseFloat(data.pfAmount) || 0,
      tasks: taskRecords,
      updatedAt: now
    };

    if (this.templateEditingId) {
      record.createdAt = this._getRetainerTemplateById(this.templateEditingId)?.createdAt || now;
      this._updateRetainerTemplate(this.templateEditingId, record);
    } else {
      record.createdAt = now;
      await this._addRetainerTemplate(record);
    }

    this.view = 'templates';
    this.templateEditingId = null;
    closeFormPanelAndRoute('#operations');
  },

  async renderArchive() {
    await WorkflowData.loadPendingApprovals();
    const entity = Auth.activeEntity;
    const self = this;
    const isManagerial = Auth.isManagerial();

    // Build a task map that merges the local task cache with any tasks returned
    // by the archived server fetch. This lets visibility checks use the same
    // canViewWrWithTasks helper that tab nav uses, and avoids losing staff-level
    // visibility when the server response carries fresh tasks.
    const taskMap = { ...(this._tempTaskMap || buildTaskMap()) };

    const wrFilter = wr => {
      const wrEnt = (wr.entity || '').toUpperCase();
      const matchesEntity = (entity === 'ALL' ? Auth.user.entities.map(ae => ae.toUpperCase()).includes(wrEnt) : wrEnt === entity.toUpperCase());
      return matchesEntity && Auth.canViewWrWithTasks(wr, taskMap);
    };

    const isFirstPageOrSkip = (this._archivePage || 1) === 1 || (this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration);
    const skipServerFetch = this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration;

    let archivedWrs = [];
    if (!skipServerFetch) {
      try {
        const res = await window.apiClient.workRequests.list({ archived: true, includeTasks: true });
        archivedWrs = (res.data || []).map(wr => WorkflowData.normalizeWorkRequest(wr));
      } catch (e) {
        console.error('Failed to load archived work requests', e);
      }
    }

    // Merge server-fetched tasks into the visibility map so staff-level checks
    // still work for server-only archived rows. Fall back to server tasks when
    // the local task entry is empty too, since an empty local array would block
    // visibility even though the server returned assigned tasks.
    archivedWrs.forEach(wr => {
      if (wr.tasks && wr.tasks.length && (!taskMap[wr.id] || taskMap[wr.id].length === 0)) {
        taskMap[wr.id] = wr.tasks;
      }
    });

    // On the first page or during an optimistic skip, merge locally archived/cancelled
    // rows so a just-archived/cancelled WR remains visible without waiting for the server.
    const localArchived = isFirstPageOrSkip
      ? WorkflowData.getAllWorkRequests().filter(wr => wrFilter(wr) && (wr.archived === true || wr.status === 'Cancelled'))
      : [];
    const wrMap = new Map();
    archivedWrs.forEach(wr => wrMap.set(wr.id, wr));
    localArchived.forEach(wr => {
      if (!wrMap.has(wr.id)) wrMap.set(wr.id, wr);
    });
    const accomplished = Array.from(wrMap.values()).filter(wr => {
      const cached = WorkflowData.getWorkRequestById(wr.id);
      const state = cached || wr;
      // Exclude work requests that have been restored to an active state locally.
      return wrFilter(state) && state.archived === true && state.status === 'Completed';
    });
    const cancelledMap = new Map();
    archivedWrs.concat(WorkflowData.getAllWorkRequests()).forEach(wr => {
      const cached = WorkflowData.getWorkRequestById(wr.id);
      const state = cached || wr;
      // A cancelled row belongs in the archive only if it is NOT currently active.
      if (wrFilter(state) && state.status === 'Cancelled' && !Workflow._isActiveWorkRequest(state)) {
        cancelledMap.set(state.id, state);
      }
    });
    const cancelled = Array.from(cancelledMap.values());

    const rejectedRecords = WorkflowData.getPendingApprovalsWhere(pc => {
      if (pc.status !== 'rejected') return false;
      if (pc.table === 'workRequests') return true;
      if (pc.table === 'tasks' && pc.proposedData && pc.proposedData.workRequestId) return true;
      return false;
    });

    const buildWrItem = (wr, category) => {
      const client = window.apiClient.clientCache.getById(wr.clientId);
      return {
        id: wr.id,
        category,
        title: wr.title || '(untitled)',
        meta: [
          { icon: ArchivePage.icons.client, text: client?.name || '—' },
          { icon: ArchivePage.icons.status, text: wr.status || '—' },
          { icon: ArchivePage.icons.date, text: formatDate(wr.updatedAt) }
        ],
        actions: [
          {
            label: 'View',
            icon: ArchivePage.icons.view,
            onClick: () => { this._navigateToWrDetail(wr.id); }
          },
          ...(category === 'accomplished' ? [{
            label: 'Unarchive',
            icon: ArchivePage.icons.unarchive,
            className: 'primary',
            onClick: () => self.unarchiveWorkRequest(wr.id)
          }] : []),
          ...(category === 'cancelled' && isManagerial ? [{
            label: 'Restore to Draft',
            icon: ArchivePage.icons.restore,
            className: 'primary',
            onClick: () => {
              self.showConfirm('Restore Work Request',
                `Restore "${wr.title}" to Draft? Tasks will remain Cancelled and must be reassigned manually.`,
                async () => {
                  await self._withArchiveLock(async () => {
                    await self.runBlockingArchiveAction({
                      title: 'Restoring Work Request',
                      message: `Please wait while "${wr.title}" is being restored to Draft...`,
                      apiCall: () => WorkflowData.updateWorkRequest(wr.id, { status: 'Draft', archived: false, updatedAt: new Date().toISOString() }),
                      successTitle: 'Restored',
                      successMessage: `Work request "${wr.title}" has been restored to Draft.`,
                      errorTitle: 'Failed to Restore Work Request',
                      onSuccess: async (res) => {
                        self._applyServerRecordToCache(wr.id, res?.data);
                      },
                      onAfterConfirm: async () => {
                        if (typeof window.apiClient?.workRequestCache?.invalidate === 'function') {
                          window.apiClient.workRequestCache.invalidate();
                        }
                        if (typeof window.apiClient?.workRequests?.invalidateCounts === 'function') {
                          window.apiClient.workRequests.invalidateCounts();
                        }
                        if (typeof WorkflowData.invalidateRelatedForWorkRequest === 'function') {
                          WorkflowData.invalidateRelatedForWorkRequest(wr.id);
                        }
                        App.updateSidebarNotifications().catch(() => {});
                        App.handleRoute();
                      }
                    });
                  });
                },
                'warning'
              );
            }
          }] : [])
        ]
      };
    };

    const buildRejectedItem = pc => {
      const isTask = pc.table === 'tasks';
      const data = pc.proposedData || {};
      const wrId = isTask ? data.workRequestId : data.id;
      const wr = WorkflowData.getWorkRequestById(wrId);
      const title = isTask ? `Task: ${data.title || '(untitled)'}` : `Work Request: ${data.title || '(untitled)'}`;
      return {
        id: pc.id,
        category: 'rejected',
        title: title,
        meta: [
          { icon: ArchivePage.icons.client, text: wr ? (window.apiClient.clientCache.getById(wr.clientId)?.name || '—') : '—' },
          { icon: ArchivePage.icons.date, text: formatDate(pc.reviewedAt || pc.updatedAt || pc.requestedAt) },
          { icon: ArchivePage.icons.status, text: pc.rejectionReason ? `Reason: ${pc.rejectionReason}` : 'Rejected' }
        ],
        actions: [
          {
            label: 'View Request',
            icon: ArchivePage.icons.view,
            onClick: () => {
              if (wr) this._navigateToWrDetail(wr.id);
            }
          }
        ]
      };
    };

    const storageKey = 'erp_archive_category_operations';
    const selectedCategory = sessionStorage.getItem(storageKey) || 'all';

    const accomplishedItems = accomplished.map(wr => buildWrItem(wr, 'accomplished'));
    const cancelledItems = cancelled.map(wr => buildWrItem(wr, 'cancelled'));
    const rejectedItems = rejectedRecords.map(buildRejectedItem);

    let totalFiltered = 0;
    if (selectedCategory === 'all') {
      totalFiltered = accomplishedItems.length + cancelledItems.length + rejectedItems.length;
    } else if (selectedCategory === 'accomplished') {
      totalFiltered = accomplishedItems.length;
    } else if (selectedCategory === 'cancelled') {
      totalFiltered = cancelledItems.length;
    } else if (selectedCategory === 'rejected') {
      totalFiltered = rejectedItems.length;
    }

    const page = this._archivePage || 1;
    const limit = this._archiveLimit || 10;

    return ArchivePage.render({
      module: 'operations',
      categoryLabels: { accomplished: 'Completed', cancelled: 'Cancelled', rejected: 'Rejected' },
      categories: {
        accomplished: accomplishedItems,
        cancelled: cancelledItems,
        rejected: rejectedItems
      },
      emptyText: 'Archive is empty.',
      renderCallback: () => { self.renderArchive().catch(() => {}); },
      pagination: {
        page,
        limit,
        total: totalFiltered,
        onPage: (newPage) => {
          self._archivePage = newPage;
          App.handleRoute();
        }
      }
    });
  },

  async generateFromTemplate(templateId) {
    const template = this._getRetainerTemplateById(templateId);
    if (!template) return;
    const now = new Date();
    const nowIso = now.toISOString();
    const titleSuffix = now.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
    const dueDate = new Date(now.getTime() + (template.schedule === 'quarterly' ? 90 : 30) * 86400000);

    const workRequest = {
      id: generateId('wr'),
      title: `${template.name} (${titleSuffix})`,
      description: template.description || '',
      clientId: template.clientId,
      priority: 'Priority',
      dueDate: dueDate.toISOString().slice(0, 10),
      entity: template.entity,
      status: 'Draft',
      createdAt: nowIso,
      updatedAt: nowIso,
      boardOrder: 0
    };

    // Optimistic WR + tasks insert so the active list badge updates immediately.
    WorkflowData._addOptimisticWorkRequest(workRequest);
    this._updateCounts(1, 0);
    const idMap = new Map();
    (template.tasks || []).forEach(t => idMap.set(t.id, generateId('t')));
    const taskRecords = [];
    for (let idx = 0; idx < (template.tasks || []).length; idx++) {
      const t = template.tasks[idx];
      const mappedPreds = (t.predecessors || []).map(pid => idMap.get(pid)).filter(Boolean);
      const taskRecord = {
        id: idMap.get(t.id),
        workRequestId: workRequest.id,
        title: t.title,
        assigneeId: t.assigneeId || null,
        assigneeName: t.assigneeName || null,
        predecessors: mappedPreds,
        status: 'Draft',
        dueDate: workRequest.dueDate,
        createdAt: nowIso,
        updatedAt: nowIso,
        sortOrder: idx
      };
      taskRecords.push(taskRecord);
      WorkflowData._addOptimisticTask(taskRecord);
    }
    const myGen = Workflow._startSkipGeneration();
    App.handleRoute();

    let createdWr;
    try {
      createdWr = await WorkflowData.createWorkRequest(workRequest);
    } catch (e) {
      console.error('Failed to generate work request from template', e);
      WorkflowData._removeWorkRequest(workRequest.id);
      for (const t of taskRecords) WorkflowData._removeTask(t.id);
      this._updateCounts(-1, 0);
      Workflow._clearSkipGenerationIfLatest(myGen);
      App.handleRoute();
      this.showMessage('Error', e.message || 'Unable to generate work request.', 'error');
      return;
    }
    const wrId = createdWr ? createdWr.id : workRequest.id;

    const failedTaskTitles = [];
    for (const taskRecord of taskRecords) {
      taskRecord.workRequestId = wrId;
      try {
        await WorkflowData.createTask(taskRecord);
      } catch (e) {
        console.error('Failed to create generated task', taskRecord.title, e);
        WorkflowData._removeTask(taskRecord.id);
        failedTaskTitles.push(taskRecord.title);
      }
    }

    if (failedTaskTitles.length > 0) {
      this.showMessage('Warning', `Work request generated but some tasks failed: ${failedTaskTitles.join(', ')}`, 'warning');
    }

    // Sync generated work request to the shared cache so billing/disbursement
    // forms can select it without a manual refresh.
    if (createdWr && window.apiClient?.workRequestCache) {
      const cache = window.apiClient.workRequestCache;
      if (!Array.isArray(cache._wrs)) cache._wrs = [];
      const normalizedForCache = { ...createdWr, tasks: createdWr.tasks || [] };
      const idx = cache._wrs.findIndex(wr => wr.id === normalizedForCache.id);
      if (idx >= 0) cache._wrs[idx] = normalizedForCache;
      else cache._wrs.push(normalizedForCache);
      cache._loadedAt = Date.now();
    }

    if (typeof Dashboard !== 'undefined' && Dashboard.invalidateCache) Dashboard.invalidateCache();
    if (typeof App !== 'undefined' && App.updateSidebarNotifications) App.updateSidebarNotifications().catch(() => {});
    Workflow._clearSkipGenerationIfLatest(myGen);
    App.handleRoute();
    location.hash = '#operations/detail/' + wrId;
  },

  async bulkGenerateFromTemplates(templateIds) {
    if (!Array.isArray(templateIds) || templateIds.length === 0) return;

    const now = new Date();
    const nowIso = now.toISOString();
    const titleSuffix = now.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
    let generatedCount = 0;
    const failedTemplates = [];

    const myGen = Workflow._startSkipGeneration();
    App.handleRoute();

    for (const templateId of templateIds) {
      const template = this._getRetainerTemplateById(templateId);
      if (!template) continue;

      const dueDate = new Date(now.getTime() + (template.schedule === 'quarterly' ? 90 : 30) * 86400000);
      const workRequest = {
        id: generateId('wr'),
        title: `${template.name} (${titleSuffix})`,
        description: template.description || '',
        clientId: template.clientId,
        priority: 'Normal',
        dueDate: dueDate.toISOString().slice(0, 10),
        entity: template.entity,
        status: 'Draft',
        createdAt: nowIso,
        updatedAt: nowIso,
        boardOrder: 0
      };

      WorkflowData._addOptimisticWorkRequest(workRequest);
      this._updateCounts(1, 0);
      let createdWr;
      try {
        createdWr = await WorkflowData.createWorkRequest(workRequest);
      } catch (e) {
        console.error('Failed to generate work request from template', template.name, e);
        WorkflowData._removeWorkRequest(workRequest.id);
        this._updateCounts(-1, 0);
        failedTemplates.push(template.name || templateId);
        continue;
      }
      const wrId = createdWr ? createdWr.id : workRequest.id;

      const idMap = new Map();
      (template.tasks || []).forEach(t => idMap.set(t.id, generateId('t')));

      const tmplTasks = template.tasks || [];
      const failedTaskTitles = [];
      const taskRecords = [];
      for (let idx = 0; idx < tmplTasks.length; idx++) {
        const t = tmplTasks[idx];
        const mappedPreds = (t.predecessors || []).map(pid => idMap.get(pid)).filter(Boolean);
        const taskRecord = {
          id: idMap.get(t.id),
          workRequestId: wrId,
          title: t.title,
          assigneeId: t.assigneeId || null,
          assigneeName: t.assigneeName || null,
          predecessors: mappedPreds,
          status: 'Draft',
          dueDate: workRequest.dueDate,
          createdAt: nowIso,
          updatedAt: nowIso,
          sortOrder: idx
        };
        taskRecords.push(taskRecord);
        WorkflowData._addOptimisticTask(taskRecord);
      }
      for (const taskRecord of taskRecords) {
        try {
          await WorkflowData.createTask(taskRecord);
        } catch (e) {
          console.error('Failed to create generated task', taskRecord.title, e);
          WorkflowData._removeTask(taskRecord.id);
          failedTaskTitles.push(taskRecord.title);
        }
      }

      if (failedTaskTitles.length > 0) {
        failedTemplates.push(`${template.name} (tasks: ${failedTaskTitles.join(', ')})`);
      } else {
        generatedCount++;
      }
    }

    if (failedTemplates.length > 0) {
      this.showMessage('Error', `Some generations failed: ${failedTemplates.join('; ')}`, 'error');
    } else {
      this.showMessage(
        'Bulk Generation Complete',
        `Successfully generated ${generatedCount} Work Requests in Draft status from the selected templates.`,
        'success'
      );
    }

    if (typeof Dashboard !== 'undefined' && Dashboard.invalidateCache) Dashboard.invalidateCache();
    if (typeof App !== 'undefined' && App.updateSidebarNotifications) App.updateSidebarNotifications().catch(() => {});

    Workflow._clearSkipGenerationIfLatest(myGen);
    this.view = 'list';
    App.handleRoute();
  }
};


